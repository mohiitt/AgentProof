import type { TrustEvent } from "./contracts";

export interface RawMarketplaceEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface RocketRideTrustPipeline {
  classify(event: RawMarketplaceEvent): Promise<TrustEvent[]>;
}
