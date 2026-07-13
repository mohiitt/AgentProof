import type { AgentRecommendation, TrustEvent, TrustRecommendation } from "../../types/contracts";
import type { AgentTrustProfile, BuyerPreferenceProfile, TrustScoreBreakdown } from "../../types/hydradb";

export interface CandidateScore {
  agent: AgentTrustProfile;
  matchedSkills: string[];
  evidenceIds: string[];
  breakdown: TrustScoreBreakdown;
  classification: "recommended" | "warn" | "avoid";
  reason: string;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function daysOld(timestamp: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(timestamp).getTime()) / 86_400_000);
}

function eventSignal(event: TrustEvent): number {
  if (event.outcome === "failed" || event.outcome === "disputed") return -1;
  if (event.edge_type === "PARTIAL_REFUND" || event.edge_type === "DISPUTED_BY" || event.edge_type === "FAILED_SKILL") return -1;
  if (event.edge_type === "DELIVERED_LATE" || event.outcome === "partial") return 0.25;
  if (event.edge_type === "REPEAT_HIRE") return 0.95;
  return 0.65 + ((event.rating ?? 3) / 5) * 0.35;
}

function incidentSeverity(event: TrustEvent): number {
  if (event.edge_type === "DELIVERED_LATE") return 0.3;
  if (event.edge_type === "PARTIAL_REFUND") return 1;
  return event.outcome === "failed" || event.outcome === "disputed" ? 1 : 0;
}

function priceFit(tier: AgentTrustProfile["price_tier"]): number {
  return { budget: 1, standard: 0.65, premium: 0.3, enterprise: 0 }[tier];
}

/** Deterministic, inspectable trust scoring with no HydraDB dependency. */
export function scoreCandidate(input: {
  agent: AgentTrustProfile;
  buyer: BuyerPreferenceProfile;
  requiredSkills: string[];
  events: TrustEvent[];
  now?: Date;
}): CandidateScore {
  const now = input.now || new Date();
  const relevantEvents = input.events.filter(
    (event) => event.agent_id === input.agent.agent_id && input.requiredSkills.includes(event.skill_id),
  );
  const matchedSkills = input.requiredSkills.filter((skill) => input.agent.claimed_skill_ids.includes(skill));
  const skillScores = input.requiredSkills.map((skill) => {
    const events = relevantEvents.filter((event) => event.skill_id === skill);
    if (!events.length) return input.agent.claimed_skill_ids.includes(skill) ? 0.25 : -0.5;
    const totalWeight = events.reduce((sum, event) => sum + Math.exp(-daysOld(event.timestamp, now) / 180), 0);
    return events.reduce((sum, event) => sum + eventSignal(event) * Math.exp(-daysOld(event.timestamp, now) / 180), 0) / totalWeight;
  });
  const normalizedSkillEvidence = clamp((skillScores.reduce((sum, score) => sum + score, 0) / skillScores.length + 1) / 2);
  const recency = relevantEvents.length
    ? relevantEvents.reduce((sum, event) => sum + Math.exp(-daysOld(event.timestamp, now) / 120), 0) / relevantEvents.length
    : 0;
  const repeatHires = relevantEvents.filter((event) => event.edge_type === "REPEAT_HIRE").length;
  const incidentPenalty = relevantEvents.reduce((sum, event) => {
    const riskWeight = 0.12 + input.buyer.risk_aversion * 0.25 + input.buyer.sla_priority * 0.1;
    return sum + incidentSeverity(event) * riskWeight * Math.exp(-daysOld(event.timestamp, now) / 180);
  }, 0);
  const verificationAndSla = (input.agent.verified ? 0.06 + input.buyer.sla_priority * 0.07 : 0)
    - (input.buyer.verification_required && !input.agent.verified ? 0.08 : 0);
  const breakdown: TrustScoreBreakdown = {
    global_rating: (input.agent.global_rating / 5) * 0.12,
    skill_evidence: normalizedSkillEvidence * 0.46,
    recency: recency * 0.1,
    repeat_hires: Math.min(repeatHires, 2) * 0.04,
    verification_and_sla: verificationAndSla,
    price_fit: priceFit(input.agent.price_tier) * input.buyer.price_sensitivity * 0.2,
    incident_penalty: -incidentPenalty,
    total: 0,
  };
  breakdown.total = clamp(
    breakdown.global_rating + breakdown.skill_evidence + breakdown.recency + breakdown.repeat_hires +
      breakdown.verification_and_sla + breakdown.price_fit + breakdown.incident_penalty,
  );
  const classification = breakdown.total >= 0.66 ? "recommended" : breakdown.total >= 0.43 ? "warn" : "avoid";
  const incidents = relevantEvents.filter((event) => incidentSeverity(event) > 0);
  return {
    agent: input.agent,
    matchedSkills,
    evidenceIds: relevantEvents.map((event) => event.trust_event_id),
    breakdown,
    classification,
    reason: incidents.length
      ? `${input.agent.display_name}: ${incidents.length} recent task-relevant incident(s); score ${breakdown.total.toFixed(2)}.`
      : `${input.agent.display_name}: recent task-relevant delivery evidence; score ${breakdown.total.toFixed(2)}.`,
  };
}

function asRecommendation(score: CandidateScore): AgentRecommendation {
  return {
    agent_id: score.agent.agent_id,
    matched_skills: score.matchedSkills,
    reason: `${score.reason} Breakdown: skill=${score.breakdown.skill_evidence.toFixed(2)}, recency=${score.breakdown.recency.toFixed(2)}, incidents=${score.breakdown.incident_penalty.toFixed(2)}, price=${score.breakdown.price_fit.toFixed(2)}.`,
    confidence: clamp(0.35 + score.matchedSkills.length * 0.08 + score.evidenceIds.length * 0.035),
    evidence_ids: score.evidenceIds,
  };
}

export function buildTrustRecommendation(input: {
  requestId: string;
  buyer: BuyerPreferenceProfile;
  taskSummary: string;
  requiredSkills: string[];
  agents: AgentTrustProfile[];
  events: TrustEvent[];
  candidateAgentIds?: string[];
  now?: Date;
}): TrustRecommendation {
  if (!input.requiredSkills.length) throw new Error("A trust recommendation requires at least one skill.");
  const candidateSet = input.candidateAgentIds ? new Set(input.candidateAgentIds) : undefined;
  const scores = input.agents
    .filter((agent) => !candidateSet || candidateSet.has(agent.agent_id))
    .map((agent) => scoreCandidate({ agent, buyer: input.buyer, requiredSkills: input.requiredSkills, events: input.events, now: input.now }))
    .sort((left, right) => right.breakdown.total - left.breakdown.total);
  if (!scores.length) throw new Error("No candidate agents were available for this recommendation.");
  const partition = (classification: CandidateScore["classification"]) => scores.filter((score) => score.classification === classification).map(asRecommendation);
  const best = scores[0];
  const evidence = best.evidenceIds.map((evidenceId) => {
    const event = input.events.find((candidate) => candidate.trust_event_id === evidenceId)!;
    return { evidence_id: evidenceId, summary: event.summary, source: event.source, observed_at: event.timestamp };
  });
  return {
    request_id: input.requestId,
    buyer_id: input.buyer.buyer_id,
    task_summary: input.taskSummary,
    required_skills: input.requiredSkills,
    recommended_agents: partition("recommended"),
    warn_agents: partition("warn"),
    avoid_agents: partition("avoid"),
    best_agent_or_team: [best.agent.agent_id],
    reasoning_summary: `${best.agent.display_name} ranks first at ${best.breakdown.total.toFixed(2)}. The score exposes global rating, skill evidence, recency, repeat hires, verification/SLA, price fit, and incident penalties; it is not a global-star ranking.`,
    evidence,
    risk_level: input.buyer.risk_aversion >= 0.75 ? "high" : input.buyer.risk_aversion >= 0.45 ? "medium" : "low",
    confidence: asRecommendation(best).confidence,
  };
}
