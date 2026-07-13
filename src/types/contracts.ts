export type RiskLevel = "low" | "medium" | "high" | "critical";
export type TrustOutcome = "passed" | "failed" | "partial" | "disputed" | "unknown";
export type TrustEdgeType =
  | "CONFIRMED_BY"
  | "DISPUTED_BY"
  | "DELIVERED_LATE"
  | "PARTIAL_REFUND"
  | "RESOLVED_IN_FAVOR_OF_BUYER"
  | "RESOLVED_IN_FAVOR_OF_WORKER"
  | "REPEAT_HIRE"
  | "FAILED_SKILL"
  | "PASSED_SKILL";

export interface TrustEvent {
  trust_event_id: string;
  job_id: string;
  buyer_id: string;
  agent_id: string;
  skill_id: string;
  skill_name: string;
  task_category: string;
  outcome: TrustOutcome;
  edge_type: TrustEdgeType;
  rating: number | null;
  price_tier: "budget" | "standard" | "premium" | "enterprise";
  complexity: "low" | "medium" | "high";
  sla_level: "none" | "standard" | "priority" | "critical";
  dispute_status: "none" | "open" | "resolved";
  arbitration_outcome: "none" | "buyer" | "worker" | "split" | "withdrawn";
  summary: string;
  reason: string;
  timestamp: string;
  source: string;
  additional_context: Record<string, unknown>;
}

export interface Skill {
  skill_id: string;
  name: string;
  description: string;
  category: string;
  input_type: string;
  output_type: string;
  risk_level: RiskLevel;
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  dependencies: string[];
  typical_failure_modes: string[];
  evaluation_criteria: string[];
  source: string;
}

export interface AgentRecommendation {
  agent_id: string;
  matched_skills: string[];
  reason: string;
  confidence: number;
  evidence_ids: string[];
}

export interface TrustRecommendation {
  request_id: string;
  buyer_id: string;
  task_summary: string;
  required_skills: string[];
  recommended_agents: AgentRecommendation[];
  warn_agents: AgentRecommendation[];
  avoid_agents: AgentRecommendation[];
  best_agent_or_team: string[];
  reasoning_summary: string;
  evidence: Array<{
    evidence_id: string;
    summary: string;
    source: string;
    observed_at: string;
  }>;
  risk_level: RiskLevel;
  confidence: number;
}
