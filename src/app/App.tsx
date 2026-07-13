import { useEffect, useMemo, useState } from "react";

import buyerData from "../../data/seed/buyer-preferences.json";
import agentData from "../../data/seed/agents.json";
import claimData from "../../data/seed/agent-skill-claims.json";
import skillData from "../../data/seed/skills.json";
import trustEventData from "../../data/seed/trust-events.json";
import { extractSkills } from "../lib/rocketride/extractSkills";
import { buildTrustRecommendation, scoreCandidate, type CandidateScore } from "../lib/trust/scoring";
import type { AgentRecommendation, TrustEvent, TrustRecommendation } from "../types/contracts";
import type { AgentSkillClaimRecord, AgentTrustProfile, BuyerPreferenceProfile, SkillSeedRecord } from "../types/hydradb";

const buyers = buyerData as BuyerPreferenceProfile[];
const agents = agentData as AgentTrustProfile[];
const claims = claimData as AgentSkillClaimRecord[];
const skills = skillData as SkillSeedRecord[];
const trustEvents = trustEventData as TrustEvent[];

const examples = [
  {
    label: "500-PDF extraction",
    task: "Extract structured data from 500 PDFs into a clean, validated CSV.",
  },
  {
    label: "Research brief",
    task: "Research the market using primary web sources and check every citation.",
  },
] as const;

type Classification = "recommended" | "warn" | "avoid";

type RankedAgent = AgentRecommendation & {
  classification: Classification;
};

type LiveToolStatus = "connected" | "offline_fallback" | "not_configured" | "error";
type DemoMode = "demo" | "live";
type LivePhase = "idle" | "rocketride" | "hydradb" | "scoring" | "ready" | "error";
export type AppView = "landing" | "demo";

const JOURNEY_REVEAL_DELAY_MS = 520;
const RESULT_REVEAL_DELAY_MS = 520;
const COMPLETE_RESULT_REVEAL_STAGE = 8;
export const INITIAL_APP_VIEW: AppView = "landing";

export interface HydraDbProofCard {
  id: string;
  eyebrow: string;
  title: string;
  metric: string;
  caption: string;
  imageSrc: string;
  imageAlt: string;
}

export interface LandingPipelineFrame {
  id: string;
  system: string;
  title: string;
  state: string;
  input: string;
  output: string;
  detail: string;
}

export const hydraDbProofCards: HydraDbProofCard[] = [
  {
    id: "api-logs",
    eyebrow: "API logs",
    title: "Ingestion, query, and readiness calls succeeded",
    metric: "success events",
    caption: "HydraDB shows successful context ingestion, status checks, and trust queries for batch PDF extraction and verified delivery history.",
    imageSrc: "/hydradb-proof/api-logs.png",
    imageAlt: "HydraDB API logs with successful ingestion, query, and status requests.",
  },
  {
    id: "database-totals",
    eyebrow: "Database totals",
    title: "The default tenant contains live trust memory",
    metric: "46 knowledge · 8 memories · 32k tokens",
    caption: "The default-tenant database stores the committed AgentProof trust corpus as indexed knowledge and buyer memory.",
    imageSrc: "/hydradb-proof/database-totals.png",
    imageAlt: "HydraDB databases page showing default-tenant with 46 knowledge records, 8 memories, and 32k tokens.",
  },
  {
    id: "knowledge-graph",
    eyebrow: "Knowledge graph",
    title: "Agent, skill, claim, price, risk, and event relations are connected",
    metric: "150 graph nodes",
    caption: "The graph proof shows skill claims, outcomes, ratings, price tiers, risk levels, and task categories joined into one reasoning surface.",
    imageSrc: "/hydradb-proof/knowledge-graph.png",
    imageAlt: "HydraDB graph view with a dense network of knowledge nodes and relation edges.",
  },
  {
    id: "indexed-context",
    eyebrow: "Indexed context",
    title: "Trust events are stored as searchable source documents",
    metric: "46 indexed files",
    caption: "HydraDB stores individual trust events with metadata such as agent, buyer, skill, outcome, price tier, SLA, and timestamp.",
    imageSrc: "/hydradb-proof/indexed-context.png",
    imageAlt: "HydraDB context page showing indexed trust event documents and JSON metadata.",
  },
];

export const landingPipelineFrames: LandingPipelineFrame[] = [
  {
    id: "input",
    system: "Input",
    title: "Buyer submits job",
    state: "Received",
    input: "500 PDFs → clean CSV",
    output: "Task brief + buyer memory profile",
    detail: "AgentProof starts with the buyer's exact job and preference profile, not a generic rating leaderboard.",
  },
  {
    id: "rocketride",
    system: "RocketRide",
    title: "Pipeline running",
    state: "Decomposing skills",
    input: "Job brief",
    output: "PDF OCR · batch extraction · validation",
    detail: "RocketRide turns natural-language work into skill IDs and contract-shaped trust-event signals.",
  },
  {
    id: "hydradb",
    system: "HydraDB",
    title: "Memory retrieval",
    state: "Querying evidence",
    input: "Skills + trust event JSON",
    output: "46 knowledge · 8 memories · graph context",
    detail: "HydraDB retrieves skill-level history, buyer memory, indexed context, and graph relationships.",
  },
  {
    id: "recommendation",
    system: "AgentProof",
    title: "Recommendation",
    state: "Explaining decision",
    input: "HydraDB evidence bundle",
    output: "Hire · warn · avoid + audit trail",
    detail: "The safest agent is recommended with evidence, scoring, buyer-memory effects, and contract JSON.",
  },
];

export function landingActionTarget(action: "launch-demo" | "view-proof"): AppView | "#hydradb-proof" {
  return action === "launch-demo" ? "demo" : "#hydradb-proof";
}

interface LiveToolCheckResponse {
  tool: "HydraDB" | "RocketRide";
  status: LiveToolStatus;
  summary: string;
  details: Record<string, unknown>;
  checked_at: string;
}

export type TrustJourneyStepId = "rocketride" | "hydradb" | "scoring" | "recommendation";

export interface TrustJourneyStep {
  id: TrustJourneyStepId;
  system: string;
  title: string;
  summary: string;
  detail: string;
  stats: string[];
  tokens: string[];
}

export interface ScoreAudit {
  agent_id: string;
  display_name: string;
  label: string;
  classification: Classification;
  confidence: number;
  claimed_required_skills: number;
  required_skill_count: number;
  proven_successes: number;
  incidents: number;
  breakdown: Array<{ label: string; value: number; tone: "positive" | "negative" | "neutral" }>;
  summary: string;
}

export interface ClaimProofSummary {
  agent_id: string;
  display_name: string;
  claimed_required_skills: number;
  total_claimed_skills: number;
  required_skill_count: number;
  verified_claims: number;
  proven_successes: number;
  incidents: number;
  summary: string;
}

export interface BuyerMemoryRow {
  buyer_id: string;
  display_name: string;
  winner_name: string;
  classification: Classification;
  risk_level: string;
  confidence: number;
  price_fit: number;
  budget_alternative?: {
    name: string;
    classification: Classification;
    confidence: number;
    price_fit: number;
  };
}

const demoStorySteps = [
  {
    label: "01 / Input",
    title: "Buyer describes the job",
    detail: "The demo starts with the brief and buyer memory profile.",
  },
  {
    label: "02 / Tools",
    title: "RocketRide and HydraDB verify",
    detail: "RocketRide resolves skills; HydraDB retrieves evidence and memory.",
  },
  {
    label: "03 / Score",
    title: "AgentProof compares candidates",
    detail: "Recent skill evidence, incidents, price fit, and buyer risk are weighted.",
  },
  {
    label: "04 / Audit",
    title: "Recommendation stays explainable",
    detail: "The winner, rejected agent, evidence, buyer effect, and JSON contract remain inspectable.",
  },
] as const;

function recommendationFor(task: string, requiredSkills: string[], buyer: BuyerPreferenceProfile): TrustRecommendation {
  return buildTrustRecommendation({
    requestId: `demo-${buyer.buyer_id}`,
    buyer,
    taskSummary: task,
    requiredSkills,
    agents,
    events: trustEvents,
    now: new Date("2026-07-13T12:00:00.000Z"),
  });
}

export function rankedAgents(recommendation: TrustRecommendation): RankedAgent[] {
  return [
    ...recommendation.recommended_agents.map((agent) => ({ ...agent, classification: "recommended" as const })),
    ...recommendation.warn_agents.map((agent) => ({ ...agent, classification: "warn" as const })),
    ...recommendation.avoid_agents.map((agent) => ({ ...agent, classification: "avoid" as const })),
  ];
}

function confidenceFor(score: CandidateScore): number {
  return Math.max(0, Math.min(1, 0.35 + score.matchedSkills.length * 0.08 + score.evidenceIds.length * 0.035));
}

function scoreFor(agentId: string, buyer: BuyerPreferenceProfile, requiredSkillIds: string[]): CandidateScore | undefined {
  const agent = agents.find((candidate) => candidate.agent_id === agentId);
  if (!agent) return undefined;
  return scoreCandidate({
    agent,
    buyer,
    requiredSkills: requiredSkillIds,
    events: trustEvents,
    now: new Date("2026-07-13T12:00:00.000Z"),
  });
}

function successEvents(agentId: string, requiredSkillIds: string[]): TrustEvent[] {
  return trustEvents.filter((event) => event.agent_id === agentId
    && requiredSkillIds.includes(event.skill_id)
    && (event.outcome === "passed" || event.edge_type === "REPEAT_HIRE"));
}

function incidentEvents(agentId: string, requiredSkillIds: string[]): TrustEvent[] {
  return trustEvents.filter((event) => event.agent_id === agentId
    && requiredSkillIds.includes(event.skill_id)
    && (event.outcome === "failed" || event.outcome === "disputed" || event.outcome === "partial"
      || ["DELIVERED_LATE", "PARTIAL_REFUND", "DISPUTED_BY", "FAILED_SKILL"].includes(event.edge_type)));
}

export function buildScoreAudits(input: {
  buyer: BuyerPreferenceProfile;
  requiredSkillIds: string[];
  recommendation: TrustRecommendation;
}): ScoreAudit[] {
  const scored = agents
    .map((agent) => scoreCandidate({
      agent,
      buyer: input.buyer,
      requiredSkills: input.requiredSkillIds,
      events: trustEvents,
      now: new Date("2026-07-13T12:00:00.000Z"),
    }))
    .sort((left, right) => right.breakdown.total - left.breakdown.total);
  const winner = scored.find((score) => score.agent.agent_id === input.recommendation.best_agent_or_team[0]) ?? scored[0];
  const rejected = scored.find((score) => score.agent.agent_id === "agent_a" && score.agent.agent_id !== winner.agent.agent_id)
    ?? [...scored].reverse().find((score) => score.agent.agent_id !== winner.agent.agent_id);
  return [winner, rejected].filter((score): score is CandidateScore => Boolean(score)).map((score, index) => {
    const successes = successEvents(score.agent.agent_id, input.requiredSkillIds);
    const incidents = incidentEvents(score.agent.agent_id, input.requiredSkillIds);
    return {
      agent_id: score.agent.agent_id,
      display_name: score.agent.display_name,
      label: index === 0 ? "Recommended agent" : "Rejected comparison",
      classification: score.classification,
      confidence: confidenceFor(score),
      claimed_required_skills: score.matchedSkills.length,
      required_skill_count: input.requiredSkillIds.length,
      proven_successes: successes.length,
      incidents: incidents.length,
      breakdown: [
        { label: "Global rating", value: score.breakdown.global_rating, tone: "positive" },
        { label: "Skill evidence", value: score.breakdown.skill_evidence, tone: "positive" },
        { label: "Recency", value: score.breakdown.recency, tone: "positive" },
        { label: "Repeat hire", value: score.breakdown.repeat_hires, tone: "positive" },
        { label: "Verified/SLA", value: score.breakdown.verification_and_sla, tone: score.breakdown.verification_and_sla >= 0 ? "positive" : "negative" },
        { label: "Price fit", value: score.breakdown.price_fit, tone: "neutral" },
        { label: "Incidents", value: score.breakdown.incident_penalty, tone: score.breakdown.incident_penalty < 0 ? "negative" : "neutral" },
        { label: "Total", value: score.breakdown.total, tone: score.breakdown.total >= 0.66 ? "positive" : score.breakdown.total >= 0.43 ? "neutral" : "negative" },
      ],
      summary: incidents.length
        ? `${score.agent.display_name} has ${incidents.length} task-relevant incident(s), so proven evidence lowers the trust score.`
        : `${score.agent.display_name} has recent proven outcomes and no task-relevant incident penalty for this brief.`,
    };
  });
}

export function buildClaimProofSummaries(requiredSkillIds: string[]): ClaimProofSummary[] {
  return ["agent_a", "agent_b"].map((agentId) => {
    const agent = agents.find((candidate) => candidate.agent_id === agentId)!;
    const agentClaims = claims.filter((claim) => claim.agent_id === agentId);
    const requiredClaims = requiredSkillIds.filter((skillId) => agent.claimed_skill_ids.includes(skillId));
    const verifiedClaims = agentClaims.filter((claim) => requiredSkillIds.includes(claim.skill_id) && claim.verification === "verified_delivery_history");
    const successes = successEvents(agentId, requiredSkillIds);
    const incidents = incidentEvents(agentId, requiredSkillIds);
    return {
      agent_id: agentId,
      display_name: agent.display_name,
      claimed_required_skills: requiredClaims.length,
      total_claimed_skills: agent.claimed_skill_ids.length,
      required_skill_count: requiredSkillIds.length,
      verified_claims: verifiedClaims.length,
      proven_successes: successes.length,
      incidents: incidents.length,
      summary: incidents.length
        ? `${agent.display_name} claims the work, but HydraDB evidence includes recent task-specific failures.`
        : `${agent.display_name} has fewer claims than Agent A, but the retrieved evidence is stronger for this job.`,
    };
  });
}

export function buildBuyerMemoryRows(task: string, requiredSkillIds: string[]): BuyerMemoryRow[] {
  return buyers.map((buyer) => {
    const recommendation = recommendationFor(task, requiredSkillIds, buyer);
    const winner = agents.find((agent) => agent.agent_id === recommendation.best_agent_or_team[0])!;
    const winnerScore = scoreFor(winner.agent_id, buyer, requiredSkillIds);
    const agentCScore = scoreFor("agent_c", buyer, requiredSkillIds);
    return {
      buyer_id: buyer.buyer_id,
      display_name: buyer.display_name,
      winner_name: winner.display_name,
      classification: classificationFor(recommendation, winner.agent_id),
      risk_level: recommendation.risk_level,
      confidence: recommendation.confidence,
      price_fit: winnerScore?.breakdown.price_fit ?? 0,
      budget_alternative: agentCScore ? {
        name: agentCScore.agent.display_name,
        classification: agentCScore.classification,
        confidence: confidenceFor(agentCScore),
        price_fit: agentCScore.breakdown.price_fit,
      } : undefined,
    };
  });
}

export function buildTrustJourney(input: {
  task: string;
  requiredSkillIds: string[];
  buyer: BuyerPreferenceProfile;
  recommendation?: TrustRecommendation;
}): TrustJourneyStep[] {
  const skillById = new Map(skills.map((skill) => [skill.skill_id, skill]));
  const agentById = new Map(agents.map((agent) => [agent.agent_id, agent]));
  const matchedEvents = trustEvents.filter((event) => input.requiredSkillIds.includes(event.skill_id));
  const matchedClaims = claims.filter((claim) => input.requiredSkillIds.includes(claim.skill_id));
  const ranked = input.recommendation ? rankedAgents(input.recommendation) : [];
  const bestAgent = input.recommendation ? agentById.get(input.recommendation.best_agent_or_team[0]) : undefined;
  const agentA = agentById.get("agent_a");
  const agentB = agentById.get("agent_b");
  const agentAFailures = matchedEvents.filter((event) => event.agent_id === "agent_a" && ["failed", "disputed", "partial"].includes(event.outcome));
  const agentBPasses = matchedEvents.filter((event) => event.agent_id === "agent_b" && event.outcome === "passed");
  const resolvedSkillNames = input.requiredSkillIds.map((skillId) => skillById.get(skillId)?.name ?? titleCase(skillId));
  const topScore = ranked[0]?.confidence ? `${Math.round(ranked[0].confidence * 100)}%` : "pending";

  return [
    {
      id: "rocketride",
      system: "RocketRide",
      title: "Skills extracted from the job brief",
      summary: `The brief is mapped into ${input.requiredSkillIds.length} catalog skills before trust is scored.`,
      detail: input.task,
      stats: [`${input.requiredSkillIds.length} skills`, "PII-safe browser demo", "pure extractor"],
      tokens: resolvedSkillNames,
    },
    {
      id: "hydradb",
      system: "HydraDB",
      title: "Skill evidence and buyer memory retrieved",
      summary: `${matchedEvents.length} trust events and ${matchedClaims.length} claims match the requested skills.`,
      detail: `Collections represented: skills, agents, claimed skills, trust events, buyer memory profiles, and buyer memory for ${input.buyer.display_name}.`,
      stats: [`${matchedEvents.length} events`, `${matchedClaims.length} claims`, `${agents.length} agents`],
      tokens: ["skills", "agents", "claims", "trust events", "buyer memory"],
    },
    {
      id: "scoring",
      system: "Trust scoring",
      title: "Candidates compared by recent skill outcomes",
      summary: `${ranked.length} agents are classified into recommended, warn, and avoid groups.`,
      detail: agentA && agentB
        ? `${agentB.display_name} has ${agentBPasses.length} recent matching passes; ${agentA.display_name} has ${agentAFailures.length} recent task-specific incidents.`
        : "Global rating, skill evidence, recency, repeat hires, verification, price fit, and incidents are combined.",
      stats: [`${ranked.filter((agent) => agent.classification === "recommended").length} recommended`, `${ranked.filter((agent) => agent.classification === "warn").length} warn`, `${ranked.filter((agent) => agent.classification === "avoid").length} avoid`],
      tokens: ranked.map((agent) => `${agent.agent_id}: ${agent.classification}`),
    },
    {
      id: "recommendation",
      system: "AgentProof",
      title: "Recommendation emitted with an audit trail",
      summary: bestAgent ? `${bestAgent.display_name} is selected for ${input.buyer.display_name}.` : "Awaiting a valid task.",
      detail: input.recommendation?.reasoning_summary ?? "The final response keeps the shared recommendation contract visible.",
      stats: [`confidence ${topScore}`, input.recommendation ? titleCase(input.recommendation.risk_level) : "risk pending", "contract JSON"],
      tokens: input.recommendation?.best_agent_or_team ?? [],
    },
  ];
}

function classificationFor(recommendation: TrustRecommendation, agentId: string): Classification {
  if (recommendation.recommended_agents.some((agent) => agent.agent_id === agentId)) return "recommended";
  if (recommendation.warn_agents.some((agent) => agent.agent_id === agentId)) return "warn";
  return "avoid";
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatProofValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return "not reported";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function LandingPage(props: { onLaunchDemo: () => void; onViewProof: () => void }) {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Landing navigation">
        <a className="brand" href="#landing-top" aria-label="AgentProof landing home">
          <span className="brand-mark">AP</span>
          AgentProof
        </a>
        <div className="landing-nav-actions">
          <button type="button" className="text-button landing-link-button" onClick={props.onViewProof}>HydraDB proof</button>
          <button type="button" className="secondary-button" onClick={props.onLaunchDemo}>Launch demo</button>
        </div>
      </nav>

      <section className="landing-hero" id="landing-top">
        <div className="landing-hero-copy">
          <p className="eyebrow">HydraDB-backed trust infrastructure</p>
          <h1>Trust decisions backed by <em>live HydraDB memory.</em></h1>
          <p className="lede">
            RocketRide decomposes jobs into skills. HydraDB stores and retrieves skill evidence,
            buyer memory, graph context, and API logs. AgentProof explains the safest agent to hire.
          </p>
          <div className="landing-cta-row">
            <button type="button" className="primary-button landing-primary" onClick={props.onLaunchDemo}>
              Launch AgentProof demo <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="secondary-button" onClick={props.onViewProof}>
              View HydraDB proof
            </button>
          </div>
        </div>

        <aside className="landing-proof-console" aria-label="HydraDB proof summary">
          <span className="proof-label">Proof corpus</span>
          <strong>46 knowledge records</strong>
          <div className="proof-console-grid">
            <span>8 buyer memories</span>
            <span>32k tokens</span>
            <span>150 graph nodes</span>
            <span>success logs</span>
          </div>
          <p>Captured from the live HydraDB workspace powering AgentProof’s trust-memory demo.</p>
        </aside>
      </section>

      <section className="landing-pipeline-section" aria-labelledby="landing-pipeline-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Remotion-style flowchart</p>
            <h2 id="landing-pipeline-title">Input becomes proof, proof becomes a recommendation.</h2>
          </div>
          <p>
            A clean four-step flow for judges: the buyer submits work, RocketRide runs the pipeline,
            HydraDB retrieves trust memory, and AgentProof emits an auditable recommendation.
          </p>
        </div>

        <div className="remotion-flowchart" aria-label="AgentProof data flowchart">
          {landingPipelineFrames.map((frame, index) => (
            <article className={`flow-node flow-node-${frame.id}`} key={frame.id}>
              <div className="flow-node-topline">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <small>{frame.system}</small>
              </div>
              <div className="flow-node-body">
                <strong>{frame.title}</strong>
                <em>{frame.state}</em>
              </div>
              <div className="flow-io-grid" aria-label={`${frame.system} input and output`}>
                <div>
                  <span>Input</span>
                  <code>{frame.input}</code>
                </div>
                <div>
                  <span>Output</span>
                  <code>{frame.output}</code>
                </div>
              </div>
              <div className="flow-node-detail">
                <p>{frame.detail}</p>
              </div>
              {index < landingPipelineFrames.length - 1 && <span className="flow-connector" aria-hidden="true">→</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="landing-proof-section" id="hydradb-proof" aria-labelledby="hydradb-proof-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">HydraDB proof gallery</p>
            <h2 id="hydradb-proof-title">Not screenshots for decoration — screenshots as evidence.</h2>
          </div>
          <p>
            These four surfaces show the AgentProof trust corpus inside HydraDB: operational logs,
            tenant totals, graph structure, and indexed trust-event context.
          </p>
        </div>

        <div className="proof-gallery">
          {hydraDbProofCards.map((card) => (
            <article className={`proof-card proof-card-${card.id}`} key={card.id}>
              <div className="proof-card-copy">
                <span>{card.eyebrow}</span>
                <h3>{card.title}</h3>
                <strong>{card.metric}</strong>
                <p>{card.caption}</p>
              </div>
              <div className="proof-image-frame">
                <img src={card.imageSrc} alt={card.imageAlt} loading="lazy" />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-handoff" aria-label="Open the AgentProof demo">
        <div>
          <p className="eyebrow">Ready for the judge flow</p>
          <h2>Now run the trust decision.</h2>
          <p>Move from proof of HydraDB usage into the existing AgentProof Live/Demo analysis experience.</p>
        </div>
        <button type="button" className="primary-button landing-primary" onClick={props.onLaunchDemo}>
          Launch AgentProof demo <span aria-hidden="true">→</span>
        </button>
      </section>
    </main>
  );
}

export function App() {
  const [appView, setAppView] = useState<AppView>(INITIAL_APP_VIEW);
  const [demoMode, setDemoMode] = useState<DemoMode>("demo");
  const [task, setTask] = useState<string>(examples[0].task);
  const [buyerId, setBuyerId] = useState(buyers[0].buyer_id);
  const [submittedTask, setSubmittedTask] = useState<string>(examples[0].task);
  const [submittedBuyerId, setSubmittedBuyerId] = useState(buyers[0].buyer_id);
  const [formError, setFormError] = useState("");
  const [activeJourneyStep, setActiveJourneyStep] = useState(3);
  const [resultRevealRun, setResultRevealRun] = useState(0);
  const [resultRevealStage, setResultRevealStage] = useState(COMPLETE_RESULT_REVEAL_STAGE);
  const [livePhase, setLivePhase] = useState<LivePhase>("idle");
  const [liveTools, setLiveTools] = useState<{
    state: "idle" | "checking" | "complete";
    hydradb?: LiveToolCheckResponse;
    rocketride?: LiveToolCheckResponse;
    error?: string;
  }>({ state: "idle" });

  const requiredSkillIds = useMemo(() => extractSkills(submittedTask), [submittedTask]);
  const selectedBuyer = buyers.find((buyer) => buyer.buyer_id === submittedBuyerId) ?? buyers[0];
  const recommendation = useMemo(
    () => requiredSkillIds.length ? recommendationFor(submittedTask, requiredSkillIds, selectedBuyer) : undefined,
    [requiredSkillIds, selectedBuyer, submittedTask],
  );
  const comparison = useMemo(
    () => requiredSkillIds.length
      ? buyers.map((buyer) => ({ buyer, recommendation: recommendationFor(submittedTask, requiredSkillIds, buyer) }))
      : [],
    [requiredSkillIds, submittedTask],
  );

  const skillById = new Map(skills.map((skill) => [skill.skill_id, skill]));
  const agentById = new Map(agents.map((agent) => [agent.agent_id, agent]));
  const ranked = recommendation ? rankedAgents(recommendation) : [];
  const bestAgent = recommendation ? agentById.get(recommendation.best_agent_or_team[0]) : undefined;
  const journeySteps = useMemo(
    () => buildTrustJourney({ task: submittedTask, requiredSkillIds, buyer: selectedBuyer, recommendation }),
    [requiredSkillIds, recommendation, selectedBuyer, submittedTask],
  );
  const scoreAudits = useMemo(
    () => recommendation ? buildScoreAudits({ buyer: selectedBuyer, requiredSkillIds, recommendation }) : [],
    [recommendation, requiredSkillIds, selectedBuyer],
  );
  const claimProofSummaries = useMemo(() => buildClaimProofSummaries(requiredSkillIds), [requiredSkillIds]);
  const buyerMemoryRows = useMemo(
    () => requiredSkillIds.length ? buildBuyerMemoryRows(submittedTask, requiredSkillIds) : [],
    [requiredSkillIds, submittedTask],
  );
  const showHydraEvidence = activeJourneyStep >= 1;
  const showCandidateScoring = activeJourneyStep >= 2;
  const journeyComplete = activeJourneyStep >= journeySteps.length - 1;
  const liveModeWaiting = demoMode === "live" && livePhase === "idle";
  const liveModeFetching = demoMode === "live" && ["rocketride", "hydradb", "scoring"].includes(livePhase);
  const canShowResults = demoMode === "demo" || livePhase === "ready";
  const visibleJourneySteps = canShowResults
    ? journeySteps.slice(0, Math.min(activeJourneyStep + 1, journeySteps.length))
    : journeySteps;
  const showDecisionHero = journeyComplete && canShowResults && resultRevealStage >= 1;
  const showExplainDecision = journeyComplete && canShowResults && resultRevealStage >= 2;
  const showResolvedSkills = canShowResults && resultRevealStage >= 3;
  const showClaimProof = canShowResults && resultRevealStage >= 4;
  const showEvidenceAndBuyerMemory = showHydraEvidence && canShowResults && resultRevealStage >= 5;
  const showScoreAudit = showCandidateScoring && canShowResults && resultRevealStage >= 6;
  const showCandidateCards = showCandidateScoring && canShowResults && resultRevealStage >= 7;
  const showRecommendationJson = journeyComplete && canShowResults && resultRevealStage >= COMPLETE_RESULT_REVEAL_STAGE;
  const alternativeIncidents = useMemo(() => {
    if (!recommendation) return [];
    const alternativeIds = new Set([
      ...recommendation.recommended_agents,
      ...recommendation.warn_agents,
      ...recommendation.avoid_agents,
    ].map((candidate) => candidate.agent_id).filter((agentId) => agentId !== recommendation.best_agent_or_team[0]));
    const incidentEdges = new Set(["DELIVERED_LATE", "PARTIAL_REFUND", "DISPUTED_BY", "FAILED_SKILL", "RESOLVED_IN_FAVOR_OF_BUYER"]);
    return trustEvents
      .filter((event) => alternativeIds.has(event.agent_id)
        && requiredSkillIds.includes(event.skill_id)
        && (event.outcome === "failed" || event.outcome === "disputed" || event.outcome === "partial" || incidentEdges.has(event.edge_type)))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }, [recommendation, requiredSkillIds]);

  useEffect(() => {
    if (!resultRevealRun) return undefined;
    setActiveJourneyStep(0);
    setResultRevealStage(0);
    const journeyTimers = [1, 2, 3].map((step) => window.setTimeout(
      () => setActiveJourneyStep(step),
      step * JOURNEY_REVEAL_DELAY_MS,
    ));
    const resultStart = JOURNEY_REVEAL_DELAY_MS * 4;
    const resultTimers = Array.from({ length: COMPLETE_RESULT_REVEAL_STAGE }, (_, index) => window.setTimeout(
      () => setResultRevealStage(index + 1),
      resultStart + index * RESULT_REVEAL_DELAY_MS,
    ));
    const timers = [...journeyTimers, ...resultTimers];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [resultRevealRun]);

  async function analyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTask = task.trim();
    if (!cleanTask) {
      setFormError("Describe a job before running the trust analysis.");
      return;
    }
    const resolved = extractSkills(cleanTask);
    if (!resolved.length) {
      setFormError("No catalog skills matched. Try the PDF or research example, or mention skills such as CSV, validation, citations, or web research.");
      return;
    }
    setFormError("");
    if (demoMode === "live") {
      setLivePhase("rocketride");
      setLiveTools({ state: "checking" });
      setSubmittedTask(cleanTask);
      setSubmittedBuyerId(buyerId);
      setActiveJourneyStep(0);
      setResultRevealStage(0);
      window.setTimeout(() => document.querySelector("#analysis")?.scrollIntoView({ behavior: "smooth" }), 0);
      try {
        const rocketride = await callLiveTool("/api/rocketride/live-check", { task: cleanTask });
        setLiveTools((current) => ({ ...current, rocketride }));
        setLivePhase("hydradb");
        setActiveJourneyStep(1);
        const hydradb = await callLiveTool("/api/hydradb/live-retrieve", {
          task: cleanTask,
          buyerId,
          requiredSkillIds: resolved,
        });
        setLiveTools({ state: "complete", hydradb, rocketride });
        setLivePhase("scoring");
        setActiveJourneyStep(2);
        window.setTimeout(() => {
          setActiveJourneyStep(0);
          setResultRevealStage(0);
          setLivePhase("ready");
          setResultRevealRun((current) => current + 1);
        }, 500);
      } catch (error) {
        setLiveTools((current) => ({
          ...current,
          state: "complete",
          error: error instanceof Error ? error.message : "Live tools failed. Offline demo remains available.",
        }));
        setLivePhase("error");
        setFormError("Live mode could not complete the server-side proof checks. Switch to Demo mode or try again after the local services are ready.");
      }
      return;
    }
    setSubmittedTask(cleanTask);
    setSubmittedBuyerId(buyerId);
    setResultRevealRun((current) => current + 1);
    window.setTimeout(() => document.querySelector("#analysis")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function loadExample(example: (typeof examples)[number]) {
    setTask(example.task);
    setFormError("");
  }

  async function callLiveTool(endpoint: string, body: Record<string, unknown>): Promise<LiveToolCheckResponse> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
    return response.json() as Promise<LiveToolCheckResponse>;
  }

  async function runLiveChecks() {
    setLiveTools({ state: "checking" });
    const fallback = (tool: "HydraDB" | "RocketRide", reason: string): LiveToolCheckResponse => ({
      tool,
      status: "error",
      summary: `${tool} live proof check failed; offline demo path remains active.`,
      details: { reason },
      checked_at: new Date().toISOString(),
    });
    try {
      const [hydradb, rocketride] = await Promise.all([
        callLiveTool("/api/hydradb/live-retrieve", { task: submittedTask, buyerId: submittedBuyerId, requiredSkillIds }).catch((error) => fallback("HydraDB", error instanceof Error ? error.message : "unknown HTTP error")),
        callLiveTool("/api/rocketride/live-check", { task: submittedTask }).catch((error) => fallback("RocketRide", error instanceof Error ? error.message : "unknown HTTP error")),
      ]);
      setLiveTools({ state: "complete", hydradb, rocketride });
    } catch (error) {
      setLiveTools({
        state: "complete",
        hydradb: fallback("HydraDB", error instanceof Error ? error.message : "unknown fetch error"),
        rocketride: fallback("RocketRide", error instanceof Error ? error.message : "unknown fetch error"),
        error: "Live tool endpoints were not reachable. The offline demo path is still active.",
      });
    }
  }

  function switchMode(mode: DemoMode) {
    setDemoMode(mode);
    setFormError("");
    if (mode === "live") {
      setLivePhase("idle");
      setActiveJourneyStep(0);
      setResultRevealStage(0);
    } else {
      setLivePhase("ready");
      setActiveJourneyStep(3);
      setResultRevealStage(COMPLETE_RESULT_REVEAL_STAGE);
    }
  }

  function launchDemo() {
    setAppView("demo");
    window.setTimeout(() => document.querySelector("#top")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function viewHydraDbProof() {
    document.querySelector(landingActionTarget("view-proof"))?.scrollIntoView({ behavior: "smooth" });
  }

  if (appView === "landing") {
    return <LandingPage onLaunchDemo={launchDemo} onViewProof={viewHydraDbProof} />;
  }

  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="AgentProof home">
          <span className="brand-mark">AP</span>
          AgentProof
        </a>
        <div className="nav-links">
          <a href="#analyze">Analyze</a>
          <a href="#analysis">Results</a>
        </div>
        <span className="status"><i /> Interactive demo</span>
      </nav>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Trust infrastructure for agent marketplaces</p>
          <h1>Hire for proven skills,<br /><em>not a star average.</em></h1>
          <p className="lede">
            AgentProof decomposes a job, compares recent skill-level outcomes,
            applies buyer preferences, and explains who is safest to hire.
          </p>
        </div>
        <aside className="hero-proof" aria-label="Canonical AgentProof result">
          <span className="proof-label">{demoMode === "live" ? "Live proof" : "Canonical proof"}</span>
          <strong>{demoMode === "live" ? "Fetch first" : "4.6 beats 4.9"}</strong>
          <p>{demoMode === "live"
            ? "Live mode waits for RocketRide and HydraDB server checks before showing agent evidence or recommendations."
            : "Agent B outranks higher-rated Agent A for large PDF batches because recent, task-specific evidence matters more."}</p>
        </aside>
      </section>

      <section className="workbench" id="analyze" aria-labelledby="analyze-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Run the demo</p>
          <h2 id="analyze-title">Describe the work. Choose the buyer memory.</h2>
          </div>
          <p>The browser demo is local-first and fallback-safe. Live HydraDB and RocketRide checks are server-side and optional.</p>
        </div>

        <div className="demo-map" aria-label="Judge-facing demo path">
          <div className="demo-map-intro">
            <span>Judge path</span>
            <p>RocketRide decomposes the job into skills. HydraDB retrieves skill-level evidence and buyer memory. AgentProof recommends the safest agent.</p>
          </div>
          <ol>
            {demoStorySteps.map((step) => (
              <li key={step.label}>
                <span>{step.label}</span>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mode-toggle" role="group" aria-label="Demo mode">
          <button type="button" className={demoMode === "demo" ? "active" : ""} onClick={() => switchMode("demo")}>
            Demo mode
          </button>
          <button type="button" className={demoMode === "live" ? "active" : ""} onClick={() => switchMode("live")}>
            Live mode
          </button>
          <p>{demoMode === "live" ? "Live mode hides agent data until RocketRide and HydraDB finish server-side proof checks." : "Demo mode uses deterministic skill extraction, seed evidence, and local trust scoring."}</p>
        </div>

        <form className="analysis-form" onSubmit={analyze}>
          <div className="field field-task">
            <label htmlFor="job-brief">Job brief</label>
            <textarea
              id="job-brief"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              rows={4}
              aria-describedby={formError ? "form-error" : undefined}
            />
            <div className="example-row" aria-label="Example job briefs">
              <span>Try an example</span>
              {examples.map((example) => (
                <button type="button" className="text-button" key={example.label} onClick={() => loadExample(example)}>
                  {example.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="buyer-profile">Buyer memory profile</label>
            <select id="buyer-profile" value={buyerId} onChange={(event) => setBuyerId(event.target.value)}>
              {buyers.map((buyer) => <option value={buyer.buyer_id} key={buyer.buyer_id}>{buyer.display_name}</option>)}
            </select>
            <p className="field-help">This is not the agent. It tells AgentProof how to weight risk, price, verification, and SLA history.</p>
          </div>
          <button className="primary-button" type="submit" disabled={liveModeFetching}>
            {liveModeFetching ? "Fetching live proof" : "Analyze trust"} <span aria-hidden="true">→</span>
          </button>
          {formError && <p className="form-error" id="form-error" role="alert">{formError}</p>}
        </form>

        <article className="live-tools-panel" aria-labelledby="live-tools-title">
          <div className="live-tools-heading">
            <div>
              <p className="eyebrow">Optional proof</p>
              <h3 id="live-tools-title">Live tools</h3>
              <p>Use this when a judge asks for service proof. The main demo stays deterministic; live checks only verify RocketRide and HydraDB server-side.</p>
            </div>
            <button className="secondary-button" type="button" onClick={runLiveChecks} disabled={liveTools.state === "checking"}>
              {liveTools.state === "checking" ? "Checking..." : "Run live checks"}
            </button>
          </div>
          {liveTools.error && <p className="live-error">{liveTools.error}</p>}
          <div className="live-tool-grid">
            {[
              liveTools.hydradb ?? {
                tool: "HydraDB" as const,
                status: "offline_fallback" as const,
                summary: "HydraDB offline fallback active - using committed seed mirror until server-side live check runs.",
                details: {},
                checked_at: "",
              },
              liveTools.rocketride ?? {
                tool: "RocketRide" as const,
                status: "offline_fallback" as const,
                summary: "RocketRide offline fallback active - using deterministic local skill extraction until server-side live check runs.",
                details: {},
                checked_at: "",
              },
            ].map((tool) => (
              <div className={`live-tool-card ${tool.status}`} key={tool.tool}>
                <div>
                  <strong>{tool.tool}</strong>
                  <span>{titleCase(tool.status)}</span>
                </div>
                <p>{tool.summary}</p>
                {Object.keys(tool.details).length > 0 && (
                  <details className="tool-proof-details">
                    <summary>View proof details</summary>
                    <dl>
                      {Object.entries(tool.details).map(([key, value]) => (
                        <div key={`${tool.tool}-${key}`}>
                          <dt>{titleCase(key)}</dt>
                          <dd>{formatProofValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="results" id="analysis" aria-labelledby="results-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Decision output</p>
            <h2 id="results-title">A recommendation you can audit.</h2>
          </div>
          <p>{selectedBuyer.preference_text}</p>
        </div>

        {recommendation && bestAgent ? (
          <>
            {liveModeWaiting ? (
              <div className="live-waiting-state" role="status">
                <p className="eyebrow">Live mode armed</p>
                <h3>No agent data loaded yet.</h3>
                <p>Click <strong>Analyze trust</strong>. RocketRide will verify the brief first, then HydraDB will retrieve evidence and buyer memory before any recommendation appears.</p>
              </div>
            ) : liveModeFetching ? (
              <div className="live-waiting-state active" role="status">
                <p className="eyebrow">Live proof running</p>
                <h3>{livePhase === "rocketride" ? "RocketRide is checking the job brief." : livePhase === "hydradb" ? "HydraDB is retrieving trust memory." : "AgentProof is scoring the retrieved proof."}</h3>
                <ol className="live-fetch-steps">
                  <li className={["rocketride", "hydradb", "scoring", "ready"].includes(livePhase) ? "active" : ""}>RocketRide SDK proof</li>
                  <li className={["hydradb", "scoring", "ready"].includes(livePhase) ? "active" : ""}>HydraDB retrieval</li>
                  <li className={["scoring", "ready"].includes(livePhase) ? "active" : ""}>Trust scoring</li>
                </ol>
              </div>
            ) : undefined}

            {!liveModeWaiting && !liveModeFetching && (
              <article className="journey-panel" aria-label="Trust analysis journey" aria-live="polite">
              <div className="journey-heading">
                <div>
                  <span className="decision-kicker">Trust analysis journey</span>
                  <h3>{journeyComplete ? "Decision path complete" : journeySteps[activeJourneyStep]?.title}</h3>
                </div>
                <span className="journey-state">{journeyComplete ? "Recommendation ready" : "Analyzing"}</span>
              </div>
              <ol className="journey-steps">
                {visibleJourneySteps.map((step, index) => {
                  const state = index < activeJourneyStep ? "complete" : index === activeJourneyStep ? "active" : "pending";
                  return (
                    <li className={`journey-step ${state}`} key={step.id}>
                      <span className="journey-index">{String(index + 1).padStart(2, "0")}</span>
                      <div className="journey-copy">
                        <span>{step.system}</span>
                        <strong>{step.title}</strong>
                        <p>{step.summary}</p>
                        <small>{step.detail}</small>
                        <div className="journey-token-row">
                          {step.tokens.slice(0, 6).map((token) => <span key={`${step.id}-${token}`}>{token}</span>)}
                        </div>
                      </div>
                      <div className="journey-stats">
                        {step.stats.map((stat) => <span key={`${step.id}-${stat}`}>{stat}</span>)}
                      </div>
                    </li>
                  );
                })}
              </ol>
              </article>
            )}

            {showDecisionHero ? (
              <div className="result-reveal result-reveal-stack">
                <div className="decision-hero">
                  <div>
                    <span className="decision-kicker">Best agent under {selectedBuyer.display_name}</span>
                    <h3>{bestAgent.display_name}</h3>
                    <p>{recommendation.reasoning_summary}</p>
                  </div>
                  <div className="decision-stats" aria-label="Recommendation summary">
                    <div><span>Global rating</span><strong>{bestAgent.global_rating.toFixed(1)}</strong></div>
                    <div><span>Confidence</span><strong>{Math.round(recommendation.confidence * 100)}%</strong></div>
                    <div><span>Risk</span><strong>{titleCase(recommendation.risk_level)}</strong></div>
                  </div>
                </div>

                {showExplainDecision && <article className="explain-panel result-reveal" aria-labelledby="explain-title">
                  <div>
                    <p className="eyebrow">Explain decision</p>
                    <h3 id="explain-title">Why Agent B beats a higher rating</h3>
                  </div>
                  <p>
                    Agent A still has the stronger global rating, but HydraDB-ready evidence shows recent failures for
                    high-volume PDF extraction and validation. Agent B has fresher matching passes and repeat-hire
                    evidence for the exact skill context, so the trust score favors Agent B for this buyer.
                  </p>
                </article>}
              </div>
            ) : !liveModeWaiting && !liveModeFetching ? (
              <div className="analysis-holding" role="status">
                Revealing the decision path before showing the recommended agent.
              </div>
            ) : undefined}

            {showResolvedSkills && <div className="skill-strip result-reveal" aria-label="Resolved skills">
              <span>Resolved skills</span>
              <div>
                {requiredSkillIds.map((skillId) => <span className="skill-pill" key={skillId}>{skillById.get(skillId)?.name ?? titleCase(skillId)}</span>)}
              </div>
            </div>}

            {showClaimProof && <div className="claim-proof-grid result-reveal" aria-label="Claimed skills versus proven skills">
              <article className="panel claim-proof-intro">
                <div className="panel-heading">
                  <span className="eyebrow">Claims are not trust</span>
                  <strong>Claimed skills vs proven skills</strong>
                </div>
                <p>HydraDB keeps self-claimed capability separate from verified delivery evidence, so recent outcomes can beat a better-looking profile.</p>
              </article>
              {claimProofSummaries.map((summary) => (
                <article className="claim-proof-card" key={summary.agent_id}>
                  <span>{summary.display_name}</span>
                  <strong>{summary.claimed_required_skills}/{summary.required_skill_count} task skills claimed</strong>
                  <div>
                    <small>{summary.total_claimed_skills} catalog claims</small>
                    <small>{summary.verified_claims} verified claims</small>
                    <small>{summary.proven_successes} proven successes</small>
                    <small>{summary.incidents} incidents</small>
                  </div>
                  <p>{summary.summary}</p>
                </article>
              ))}
            </div>}

            {showEvidenceAndBuyerMemory ? (
              <div className="evidence-layout result-reveal">
                <article className="panel">
                  <div className="panel-heading">
                    <span className="eyebrow">Why this result</span>
                    <strong>{recommendation.evidence.length + alternativeIncidents.length} cited events</strong>
                  </div>
                  <div className="evidence-list">
                    <p className="evidence-group-label">Evidence supporting the winner</p>
                    {recommendation.evidence.map((evidence) => {
                      const event = trustEvents.find((candidate) => candidate.trust_event_id === evidence.evidence_id);
                      return (
                        <div className="evidence-item" key={evidence.evidence_id}>
                          <span className={`event-dot ${event?.outcome ?? "unknown"}`} />
                          <div>
                            <strong>{evidence.summary}</strong>
                            <p>{event?.reason}</p>
                            <small>{event ? skillById.get(event.skill_id)?.name : "Trust evidence"} · {new Date(evidence.observed_at).toLocaleDateString()}</small>
                          </div>
                        </div>
                      );
                    })}
                    {alternativeIncidents.length > 0 && <p className="evidence-group-label">Risks found in alternatives</p>}
                    {alternativeIncidents.map((event) => (
                      <div className="evidence-item" key={event.trust_event_id}>
                        <span className={`event-dot ${event.outcome}`} />
                        <div>
                          <strong>{agentById.get(event.agent_id)?.display_name}: {event.summary}</strong>
                          <p>{event.reason}</p>
                          <small>{skillById.get(event.skill_id)?.name ?? titleCase(event.skill_id)} · {new Date(event.timestamp).toLocaleDateString()}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel buyer-comparison">
                  <div className="panel-heading">
                    <span className="eyebrow">Buyer memory comparison</span>
                    <strong>Same task, different buyer preferences</strong>
                  </div>
                  <div className="buyer-list">
                    {comparison.map(({ buyer, recommendation: buyerRecommendation }) => {
                      const winner = agentById.get(buyerRecommendation.best_agent_or_team[0]);
                      const classification = classificationFor(buyerRecommendation, buyerRecommendation.best_agent_or_team[0]);
                      const row = buyerMemoryRows.find((candidate) => candidate.buyer_id === buyer.buyer_id);
                      return (
                        <button
                          type="button"
                          className={buyer.buyer_id === submittedBuyerId ? "buyer-row active" : "buyer-row"}
                          key={buyer.buyer_id}
                          onClick={() => { setBuyerId(buyer.buyer_id); setSubmittedBuyerId(buyer.buyer_id); }}
                        >
                          <span>
                            <strong>{buyer.display_name}</strong>
                            <small>{Math.round(buyer.risk_aversion * 100)}% risk aversion · {Math.round(buyer.price_sensitivity * 100)}% price weight</small>
                            {row?.budget_alternative && buyer.buyer_id === "buyer_price_sensitive" && (
                              <small>{row.budget_alternative.name.split(" — ")[0]} becomes a {row.budget_alternative.classification} budget alternative</small>
                            )}
                          </span>
                          <span>
                            <strong>{winner?.display_name.split(" — ")[0]}</strong>
                            <small className={classification}>{classification}</small>
                            <small>{row ? `${Math.round(row.confidence * 100)}% confidence · ${titleCase(row.risk_level)} risk` : ""}</small>
                            <small>{row ? `price fit +${row.price_fit.toFixed(2)}` : ""}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </article>
              </div>
            ) : journeyComplete && showClaimProof && !liveModeWaiting && !liveModeFetching ? (
              <div className="analysis-holding compact" role="status">
                HydraDB evidence and buyer memory appear after the recommendation summary.
              </div>
            ) : undefined}

            {showScoreAudit ? (
              <>
                <div className="score-audit-grid result-reveal" aria-label="Trust score audit">
                  {scoreAudits.map((audit) => (
                    <article className={`score-audit-card ${audit.classification}`} key={audit.agent_id}>
                      <div className="score-audit-topline">
                        <span>{audit.label}</span>
                        <small className={audit.classification}>{audit.classification}</small>
                      </div>
                      <h3>{audit.display_name}</h3>
                      <p>{audit.summary}</p>
                      <div className="score-audit-metrics">
                        <span>{audit.claimed_required_skills}/{audit.required_skill_count} claimed</span>
                        <span>{audit.proven_successes} successes</span>
                        <span>{audit.incidents} incidents</span>
                        <span>{Math.round(audit.confidence * 100)}% confidence</span>
                      </div>
                      <div className="score-breakdown">
                        {audit.breakdown.map((item) => (
                          <div className={item.tone} key={`${audit.agent_id}-${item.label}`}>
                            <span>{item.label}</span>
                            <strong>{item.value >= 0 && item.label !== "Total" ? "+" : ""}{item.value.toFixed(2)}</strong>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                {showCandidateCards && (
                  <details className="candidate-details result-reveal">
                    <summary>View full candidate roster</summary>
                    <div className="candidate-grid" aria-label="Candidate comparison">
                      {ranked.map((candidate) => {
                        const agent = agentById.get(candidate.agent_id);
                        if (!agent) return null;
                        return (
                          <article className={`candidate-card ${candidate.classification}`} key={candidate.agent_id}>
                            <div className="candidate-topline">
                              <span className={`classification ${candidate.classification}`}>{candidate.classification}</span>
                              <span>{agent.verified ? "Verified" : "Unverified"}</span>
                            </div>
                            <h3>{agent.display_name}</h3>
                            <div className="candidate-metrics">
                              <span><strong>{agent.global_rating.toFixed(1)}</strong> rating</span>
                              <span><strong>{titleCase(agent.price_tier)}</strong> price</span>
                              <span><strong>{candidate.matched_skills.length}/{requiredSkillIds.length}</strong> skills</span>
                            </div>
                            <p>{candidate.reason}</p>
                            <div className="evidence-count">{candidate.evidence_ids.length} relevant evidence records</div>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                )}
              </>
            ) : showEvidenceAndBuyerMemory && !liveModeWaiting && !liveModeFetching ? (
              <div className="analysis-holding compact" role="status">
                Auditable scoring appears after evidence and buyer memory are visible.
              </div>
            ) : undefined}

            {showRecommendationJson && (
              <details className="json-output result-reveal">
                <summary>View contract-shaped recommendation JSON</summary>
                <pre>{JSON.stringify(recommendation, null, 2)}</pre>
              </details>
            )}
          </>
        ) : (
          <div className="empty-state">Enter a job that matches the skill catalog to generate a recommendation.</div>
        )}
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">AP</span>AgentProof</a>
        <p>Skill-specific evidence · buyer-aware decisions · auditable recommendations</p>
      </footer>
    </main>
  );
}
