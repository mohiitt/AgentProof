import type { TrustEvent, TrustRecommendation } from "./contracts";

/** Product-facing HydraDB configuration. `databaseId` maps to HydraDB v2 `database`. */
export interface HydraDbConnectionConfig {
  apiKey?: string;
  databaseId?: string;
  baseUrl: string;
  liveEnabled: boolean;
}

export interface BuyerPreferenceProfile {
  buyer_id: string;
  display_name: string;
  risk_aversion: number;
  price_sensitivity: number;
  verification_required: boolean;
  sla_priority: number;
  preference_text: string;
}

export interface AgentTrustProfile {
  agent_id: string;
  display_name: string;
  global_rating: number;
  price_tier: "budget" | "standard" | "premium" | "enterprise";
  verified: boolean;
  claimed_skill_ids: string[];
}

export interface SkillSeedRecord {
  skill_id: string;
  name: string;
  description: string;
  category: string;
  input_type: string;
  output_type: string;
  risk_level: string;
  difficulty: string;
  dependencies: string[];
  typical_failure_modes: string[];
  evaluation_criteria: string[];
  source: string;
}

export interface AgentSkillClaimRecord {
  agent_id: string;
  skill_id: string;
  claim_status: string;
  verification: string;
  note: string;
}

export interface HydraRetrievalDiagnostics {
  returned_chunk_count: number;
  shared_knowledge_chunk_count: number;
  personalized_chunk_count: number;
  returned_source_ids: string[];
  matched_trust_event_ids: string[];
  unmatched_source_ids: string[];
}

export interface HydraGroundedRecommendation {
  recommendation: TrustRecommendation;
  retrieval: HydraRetrievalDiagnostics;
}

export interface TrustScoreBreakdown {
  global_rating: number;
  skill_evidence: number;
  recency: number;
  repeat_hires: number;
  verification_and_sla: number;
  price_fit: number;
  incident_penalty: number;
  total: number;
}

export interface HydraDbTrustStore {
  ingest(event: TrustEvent): Promise<void>;
  recommend(input: {
    buyer_id: string;
    task_summary: string;
    required_skills: string[];
    candidate_agent_ids?: string[];
  }): Promise<TrustRecommendation>;
}
