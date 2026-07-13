import type { TrustEvent, TrustRecommendation } from "./contracts";

export interface HydraDbTrustStore {
  ingest(event: TrustEvent): Promise<void>;
  recommend(input: {
    buyer_id: string;
    task_summary: string;
    required_skills: string[];
    candidate_agent_ids?: string[];
  }): Promise<TrustRecommendation>;
}
