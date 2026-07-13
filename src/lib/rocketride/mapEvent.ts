import type {
  TrustEdgeType,
  TrustEvent,
  TrustOutcome,
} from "../../types/contracts";
import type { RawMarketplaceEvent } from "../../types/rocketride";
import { anonymizeText } from "./anonymize";

type PriceTier = TrustEvent["price_tier"];
type Complexity = TrustEvent["complexity"];
type SlaLevel = TrustEvent["sla_level"];
type DisputeStatus = TrustEvent["dispute_status"];
type ArbitrationOutcome = TrustEvent["arbitration_outcome"];

const PRICE_TIERS: PriceTier[] = ["budget", "standard", "premium", "enterprise"];
const COMPLEXITIES: Complexity[] = ["low", "medium", "high"];
const SLA_LEVELS: SlaLevel[] = ["none", "standard", "priority", "critical"];
const ARBITRATION_OUTCOMES: ArbitrationOutcome[] = ["none", "buyer", "worker", "split", "withdrawn"];

const REASON_FIELDS = ["complaint", "delay_reason", "refund_reason", "notes", "deliverable_summary"] as const;

function pickEnum<T extends string>(candidates: T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (candidates as string[]).includes(value) ? (value as T) : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

interface EdgeAndOutcome {
  edge_type: TrustEdgeType;
  outcome: TrustOutcome;
}

/**
 * R3: deterministic event_type + arbitration_outcome -> edge_type/outcome
 * lookup. We author these raw events ourselves, so there is nothing here an
 * LLM would resolve better than a table -- and a table can't hallucinate an
 * enum value the contract doesn't allow.
 */
function deriveEdgeAndOutcome(eventType: string, payload: Record<string, unknown>): EdgeAndOutcome {
  switch (eventType) {
    case "job_completed":
      return { edge_type: "CONFIRMED_BY", outcome: "passed" };
    case "job_disputed": {
      const arbitration = pickEnum(ARBITRATION_OUTCOMES, payload.arbitration_outcome, "none");
      if (arbitration === "buyer") return { edge_type: "RESOLVED_IN_FAVOR_OF_BUYER", outcome: "failed" };
      if (arbitration === "worker") return { edge_type: "RESOLVED_IN_FAVOR_OF_WORKER", outcome: "partial" };
      return { edge_type: "DISPUTED_BY", outcome: "disputed" };
    }
    case "refund_issued":
      return { edge_type: "PARTIAL_REFUND", outcome: "partial" };
    case "repeat_hire":
      return { edge_type: "REPEAT_HIRE", outcome: "passed" };
    case "late_delivery":
      return { edge_type: "DELIVERED_LATE", outcome: "partial" };
    default:
      throw new Error(`mapEvent: unsupported event_type "${eventType}"`);
  }
}

function deriveDisputeStatus(eventType: string, payload: Record<string, unknown>): DisputeStatus {
  const arbitration = pickEnum(ARBITRATION_OUTCOMES, payload.arbitration_outcome, "none");
  if (arbitration !== "none") return "resolved";
  if (eventType === "job_disputed") return "open";
  return payload.dispute_status === "open" || payload.dispute_status === "resolved"
    ? payload.dispute_status
    : "none";
}

const SUMMARY_BY_EVENT: Record<string, string> = {
  job_completed: "Job completed and confirmed by buyer.",
  job_disputed: "Buyer disputed the delivered work.",
  refund_issued: "Partial refund issued after delivery.",
  repeat_hire: "Buyer rehired the same agent for a similar task.",
  late_delivery: "Delivery was completed after the agreed SLA window.",
};

const DEFAULT_REASON_BY_EVENT: Record<string, string> = {
  job_completed: "Deliverable accepted without issue.",
  job_disputed: "Dispute filed without additional detail.",
  refund_issued: "Refund issued to resolve buyer dissatisfaction.",
  repeat_hire: "Buyer chose to rehire based on prior performance.",
  late_delivery: "Delivery missed the committed timeline.",
};

/**
 * `anonymized: true` means "this text passed the R5 safety check and is safe
 * to store" -- it is true whether or not anything was actually redacted.
 * `pii_redacted` separately reports whether the scrubber found something.
 */
function deriveReason(eventType: string, payload: Record<string, unknown>): { reason: string; piiRedacted: boolean } {
  for (const field of REASON_FIELDS) {
    const raw = payload[field];
    if (typeof raw === "string" && raw.length > 0) {
      const { text, redacted } = anonymizeText(raw);
      return { reason: text, piiRedacted: redacted };
    }
  }
  return { reason: DEFAULT_REASON_BY_EVENT[eventType] ?? "No additional detail provided.", piiRedacted: false };
}

/**
 * R3 pipeline core: RawMarketplaceEvent -> TrustEvent[]. Pure and
 * SDK-independent so it is unit-testable offline; the .pipe graph
 * (webhook -> Anonymize -> response) mirrors this logic.
 */
export function mapEvent(event: RawMarketplaceEvent): TrustEvent[] {
  const payload = event.payload ?? {};
  const { edge_type, outcome } = deriveEdgeAndOutcome(event.event_type, payload);
  const { reason, piiRedacted } = deriveReason(event.event_type, payload);

  const known = new Set([
    "job_id",
    "buyer_id",
    "agent_id",
    "skill_id",
    "skill_name",
    "task_category",
    "task_summary",
    "price_tier",
    "complexity",
    "sla_level",
    "rating",
    "arbitration_outcome",
    "dispute_status",
    ...REASON_FIELDS,
  ]);
  const leftover: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!known.has(key)) leftover[key] = value;
  }

  const trustEvent: TrustEvent = {
    trust_event_id: `trust_${event.event_id}`,
    job_id: str(payload.job_id, event.event_id),
    buyer_id: str(payload.buyer_id, "unknown_buyer"),
    agent_id: str(payload.agent_id, "unknown_agent"),
    skill_id: str(payload.skill_id, "unknown_skill"),
    skill_name: str(payload.skill_name, str(payload.skill_id, "Unknown skill")),
    task_category: str(payload.task_category, "general"),
    outcome,
    edge_type,
    rating: num(payload.rating),
    price_tier: pickEnum(PRICE_TIERS, payload.price_tier, "standard"),
    complexity: pickEnum(COMPLEXITIES, payload.complexity, "medium"),
    sla_level: pickEnum(SLA_LEVELS, payload.sla_level, "standard"),
    dispute_status: deriveDisputeStatus(event.event_type, payload),
    arbitration_outcome: pickEnum(ARBITRATION_OUTCOMES, payload.arbitration_outcome, "none"),
    summary: SUMMARY_BY_EVENT[event.event_type] ?? "Marketplace event processed.",
    reason,
    timestamp: event.occurred_at,
    source: "rocketride",
    additional_context: {
      event_id: event.event_id,
      event_type: event.event_type,
      anonymized: true,
      pii_redacted: piiRedacted,
      ...leftover,
    },
  };

  return [trustEvent];
}
