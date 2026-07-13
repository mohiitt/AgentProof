// @ts-expect-error Node's dependency-free test runner resolves explicit .ts imports.
import { buildTrustRecommendation } from "../../lib/trust/scoring.ts";
import type { TrustEvent, TrustRecommendation } from "../../types/contracts";
import type {
  AgentSkillClaimRecord,
  AgentTrustProfile,
  BuyerPreferenceProfile,
  HydraGroundedRecommendation,
  SkillSeedRecord,
} from "../../types/hydradb";

export const AGENTPROOF_TENANT_METADATA_SCHEMA = [
  "skill_id", "agent_id", "buyer_id", "task_category", "outcome", "edge_type",
  "price_tier", "risk_level", "complexity", "sla_level", "dispute_status", "arbitration_outcome",
].map((name) => ({ name, data_type: "VARCHAR" as const, max_length: 256, enable_match: true }));

export interface MappedTrustKnowledge {
  database: string;
  collection: string;
  id: string;
  title: string;
  type: string;
  timestamp: string;
  content: { text: string };
  tenant_metadata: Record<string, unknown>;
  additional_metadata: Record<string, unknown>;
}

const REFERENCE_TIMESTAMP = "2026-07-13T00:00:00.000Z";
const SHARED_COLLECTION = "default";

export function mapSkillToKnowledge(skill: SkillSeedRecord, database: string): MappedTrustKnowledge {
  return {
    id: `skill_${skill.skill_id}`,
    database,
    collection: SHARED_COLLECTION,
    title: `${skill.name} skill definition`,
    type: "skill",
    timestamp: REFERENCE_TIMESTAMP,
    content: { text: `${skill.name}: ${skill.description}\nInputs: ${skill.input_type}. Outputs: ${skill.output_type}. Typical failures: ${skill.typical_failure_modes.join(", ")}. Evaluation: ${skill.evaluation_criteria.join(", ")}.` },
    tenant_metadata: { skill_id: skill.skill_id, risk_level: skill.risk_level },
    additional_metadata: {
      category: skill.category,
      input_type: skill.input_type,
      output_type: skill.output_type,
      difficulty: skill.difficulty,
      dependencies: skill.dependencies,
      typical_failure_modes: skill.typical_failure_modes,
      evaluation_criteria: skill.evaluation_criteria,
      source: skill.source,
    },
  };
}

export function mapAgentToKnowledge(agent: AgentTrustProfile, database: string): MappedTrustKnowledge {
  return {
    id: `agent_${agent.agent_id}`,
    database,
    collection: SHARED_COLLECTION,
    title: `${agent.display_name} agent profile`,
    type: "agent_profile",
    timestamp: REFERENCE_TIMESTAMP,
    content: { text: `${agent.display_name} claims these skills: ${agent.claimed_skill_ids.join(", ")}. Global rating ${agent.global_rating}; ${agent.verified ? "verified" : "not verified"}; ${agent.price_tier} price tier. Claims are not trust evidence.` },
    tenant_metadata: { agent_id: agent.agent_id, price_tier: agent.price_tier },
    additional_metadata: {
      display_name: agent.display_name,
      global_rating: agent.global_rating,
      verified: agent.verified,
      claimed_skill_ids: agent.claimed_skill_ids,
      source: "agentproof_seed",
    },
  };
}

export function mapAgentSkillClaimToKnowledge(claim: AgentSkillClaimRecord, database: string): MappedTrustKnowledge {
  return {
    id: `agent_skill_claim_${claim.agent_id}_${claim.skill_id}`,
    database,
    collection: SHARED_COLLECTION,
    title: `${claim.agent_id} claim for ${claim.skill_id}`,
    type: "agent_skill_claim",
    timestamp: REFERENCE_TIMESTAMP,
    content: { text: `${claim.agent_id} ${claim.claim_status} skill ${claim.skill_id}. Verification: ${claim.verification}. ${claim.note}` },
    tenant_metadata: { agent_id: claim.agent_id, skill_id: claim.skill_id },
    additional_metadata: {
      claim_status: claim.claim_status,
      verification: claim.verification,
      note: claim.note,
      source: "agentproof_seed",
    },
  };
}

export interface TrustEventIngestionPort {
  uploadKnowledge(items: MappedTrustKnowledge[]): Promise<unknown>;
  waitUntilProcessed(input: {
    sourceIds: string[];
    tenantId?: string;
    subTenantId?: string;
  }): Promise<unknown>;
}

export interface BuyerMemoryIngestionPort {
  addMemory(input: {
    id: string;
    tenantId: string;
    subTenantId: string;
    text: string;
    infer: boolean;
    tenantMetadata: Record<string, unknown>;
    additionalMetadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface ReferenceKnowledgeIngestionPort {
  uploadKnowledge(items: MappedTrustKnowledge[]): Promise<unknown>;
  waitUntilProcessed(input: { sourceIds: string[]; tenantId?: string; subTenantId?: string }): Promise<unknown>;
}

export interface PersonalizedRetrievalPort {
  recallKnowledge(input: {
    query: string;
    tenantId: string;
    subTenantId?: string;
    mode?: "thinking" | "fast";
    queryBy?: "hybrid" | "text";
    recencyBias?: number;
    graphContext?: boolean;
    queryApps?: boolean;
  }): Promise<unknown>;
  recallPersonalized(input: {
    query: string;
    tenantId: string;
    subTenantId?: string;
    mode?: "thinking" | "fast";
    queryBy?: "hybrid" | "text";
    recencyBias?: number;
    graphContext?: boolean;
    queryApps?: boolean;
  }): Promise<unknown>;
}

function resultIds(result: unknown, fallback: string[]): string[] {
  const ids = result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).results)
    ? (result as { results: Array<{ id?: unknown }> }).results
      .map((item) => typeof item.id === "string" ? item.id : undefined)
      .filter((id): id is string => Boolean(id))
    : [];
  return ids.length ? ids : fallback;
}

export async function ingestReferenceKnowledge(input: {
  database: string;
  skills: SkillSeedRecord[];
  agents: AgentTrustProfile[];
  claims: AgentSkillClaimRecord[];
  client: ReferenceKnowledgeIngestionPort;
}): Promise<{ skillIds: string[]; agentIds: string[]; claimIds: string[] }> {
  const batches = [
    input.skills.map((item) => mapSkillToKnowledge(item, input.database)),
    input.agents.map((item) => mapAgentToKnowledge(item, input.database)),
    input.claims.map((item) => mapAgentSkillClaimToKnowledge(item, input.database)),
  ];
  const ingested: string[][] = [];
  for (const batch of batches) {
    if (!batch.length) { ingested.push([]); continue; }
    const response = await input.client.uploadKnowledge(batch);
    const ids = resultIds(response, batch.map((item) => item.id));
    await input.client.waitUntilProcessed({ sourceIds: ids, tenantId: input.database, subTenantId: SHARED_COLLECTION });
    ingested.push(ids);
  }
  return { skillIds: ingested[0], agentIds: ingested[1], claimIds: ingested[2] };
}

export class TrustEventValidationError extends Error {
  public readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid AgentProof TrustEvent: ${problems.join(" ")}`);
    this.name = "TrustEventValidationError";
    this.problems = problems;
  }
}

const REQUIRED_EVENT_KEYS = [
  "trust_event_id", "job_id", "buyer_id", "agent_id", "skill_id", "skill_name",
  "task_category", "outcome", "edge_type", "rating", "price_tier", "complexity",
  "sla_level", "dispute_status", "arbitration_outcome", "summary", "reason",
  "timestamp", "source", "additional_context",
] as const;

const ENUMS = {
  outcome: ["passed", "failed", "partial", "disputed", "unknown"],
  edge_type: [
    "CONFIRMED_BY", "DISPUTED_BY", "DELIVERED_LATE", "PARTIAL_REFUND",
    "RESOLVED_IN_FAVOR_OF_BUYER", "RESOLVED_IN_FAVOR_OF_WORKER", "REPEAT_HIRE",
    "FAILED_SKILL", "PASSED_SKILL",
  ],
  price_tier: ["budget", "standard", "premium", "enterprise"],
  complexity: ["low", "medium", "high"],
  sla_level: ["none", "standard", "priority", "critical"],
  dispute_status: ["none", "open", "resolved"],
  arbitration_outcome: ["none", "buyer", "worker", "split", "withdrawn"],
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasEnumValue(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

/** Strict runtime equivalent of the shared JSON schema's object constraints. */
export function validateTrustEvent(value: unknown): TrustEvent {
  const problems: string[] = [];
  if (!isPlainObject(value)) throw new TrustEventValidationError(["Event must be an object."]);

  const keys = Object.keys(value);
  for (const key of REQUIRED_EVENT_KEYS) {
    if (!(key in value)) problems.push(`Missing required key '${key}'.`);
  }
  for (const key of keys) {
    if (!REQUIRED_EVENT_KEYS.includes(key as typeof REQUIRED_EVENT_KEYS[number])) {
      problems.push(`Unexpected key '${key}' (additional properties are forbidden).`);
    }
  }

  const nonEmptyStrings = [
    "trust_event_id", "job_id", "buyer_id", "agent_id", "skill_id", "skill_name",
    "task_category", "summary", "reason", "timestamp", "source",
  ];
  for (const key of nonEmptyStrings) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      problems.push(`'${key}' must be a non-empty string.`);
    }
  }
  for (const [key, values] of Object.entries(ENUMS)) {
    if (!hasEnumValue(values, value[key])) problems.push(`'${key}' has an unsupported value.`);
  }
  if (value.rating !== null && (typeof value.rating !== "number" || !Number.isFinite(value.rating) || value.rating < 0 || value.rating > 5)) {
    problems.push("'rating' must be null or a finite number between 0 and 5.");
  }
  const rfc3339DateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value.timestamp === "string" && (!rfc3339DateTime.test(value.timestamp) || Number.isNaN(Date.parse(value.timestamp)))) {
    problems.push("'timestamp' must be an RFC3339 date-time string.");
  }
  if (!isPlainObject(value.additional_context)) {
    problems.push("'additional_context' must be an object.");
  }

  if (problems.length) throw new TrustEventValidationError(problems);
  return value as unknown as TrustEvent;
}

/** Maps the shared event contract into an app_knowledge record for HydraDB. */
export function mapTrustEventToKnowledge(event: TrustEvent, tenantId: string): MappedTrustKnowledge {
  const validEvent = validateTrustEvent(event);
  return {
    database: tenantId,
    collection: SHARED_COLLECTION,
    id: validEvent.trust_event_id,
    title: `${validEvent.skill_name} trust event for ${validEvent.agent_id}`,
    type: "trust_event",
    timestamp: validEvent.timestamp,
    content: { text: [
      `Trust event ${validEvent.trust_event_id}: ${validEvent.summary}`,
      `Agent ${validEvent.agent_id} ${validEvent.outcome} ${validEvent.skill_name} (${validEvent.skill_id}).`,
      `Reason: ${validEvent.reason}`,
    ].join("\n") },
    tenant_metadata: {
      skill_id: validEvent.skill_id,
      agent_id: validEvent.agent_id,
      buyer_id: validEvent.buyer_id,
      task_category: validEvent.task_category,
      outcome: validEvent.outcome,
      edge_type: validEvent.edge_type,
      price_tier: validEvent.price_tier,
      risk_level: validEvent.complexity === "high" ? "high" : "medium",
      complexity: validEvent.complexity,
      sla_level: validEvent.sla_level,
      dispute_status: validEvent.dispute_status,
      arbitration_outcome: validEvent.arbitration_outcome,
    },
    additional_metadata: {
      job_id: validEvent.job_id,
      skill_name: validEvent.skill_name,
      rating: validEvent.rating,
      timestamp: validEvent.timestamp,
      source: validEvent.source,
      additional_context: validEvent.additional_context,
    },
  };
}

/** Buyer preference text is intentionally raw so HydraDB can infer preference memory. */
export function mapBuyerPreferenceToMemory(
  buyer: BuyerPreferenceProfile,
  tenantId: string,
): {
  id: string;
  tenantId: string;
  subTenantId: string;
  text: string;
  infer: boolean;
  tenantMetadata: Record<string, unknown>;
  additionalMetadata?: Record<string, unknown>;
} {
  return {
    id: `buyer_preference_${buyer.buyer_id}`,
    tenantId,
    subTenantId: buyer.buyer_id,
    text: buyer.preference_text,
    infer: true,
    tenantMetadata: {
      buyer_id: buyer.buyer_id,
    },
    additionalMetadata: {
      risk_aversion: buyer.risk_aversion,
      price_sensitivity: buyer.price_sensitivity,
      verification_required: buyer.verification_required,
      sla_priority: buyer.sla_priority,
    },
  };
}

export async function ingestBuyerPreference(input: {
  buyer: BuyerPreferenceProfile;
  tenantId: string;
  client: BuyerMemoryIngestionPort;
}): Promise<void> {
  await input.client.addMemory(mapBuyerPreferenceToMemory(input.buyer, input.tenantId));
}

export async function ingestTrustEvent(input: {
  event: unknown;
  tenantId: string;
  client: TrustEventIngestionPort;
}): Promise<MappedTrustKnowledge> {
  const event = validateTrustEvent(input.event);
  const knowledge = mapTrustEventToKnowledge(event, input.tenantId);
  const uploadResult = await input.client.uploadKnowledge([knowledge]);
  const sourceIds = uploadResult && typeof uploadResult === "object" && Array.isArray((uploadResult as Record<string, unknown>).results)
    ? (uploadResult as { results: Array<{ id?: unknown }> }).results
      .map((result) => typeof result.id === "string" ? result.id : undefined)
      .filter((sourceId): sourceId is string => Boolean(sourceId))
    : [];
  // API v2 returns results[].id. Offline mocks may omit it; the stable upsert id
  // is an equivalent status key and remains the fallback.
  await input.client.waitUntilProcessed({
    sourceIds: sourceIds.length ? sourceIds : [knowledge.id],
    tenantId: input.tenantId,
    subTenantId: knowledge.collection,
  });
  return knowledge;
}

export function createTrustService(input: {
  tenantId: string;
  buyers: BuyerPreferenceProfile[];
  agents: AgentTrustProfile[];
  events: TrustEvent[];
  client?: TrustEventIngestionPort;
  retrievalClient?: PersonalizedRetrievalPort;
  now?: () => Date;
}) {
  const events = [...input.events];
  return {
    async ingest(event: unknown): Promise<MappedTrustKnowledge> {
      const validated = validateTrustEvent(event);
      const knowledge = input.client
        ? await ingestTrustEvent({ event: validated, tenantId: input.tenantId, client: input.client })
        : mapTrustEventToKnowledge(validated, input.tenantId);
      events.push(validated);
      return knowledge;
    },
    recommend(request: {
      buyer_id: string;
      task_summary: string;
      required_skills: string[];
      candidate_agent_ids?: string[];
      request_id?: string;
    }): TrustRecommendation {
      const buyer = input.buyers.find((candidate) => candidate.buyer_id === request.buyer_id);
      if (!buyer) throw new Error(`Unknown buyer '${request.buyer_id}'.`);
      return buildTrustRecommendation({
        requestId: request.request_id || `trust-${request.buyer_id}-${events.length}`,
        buyer,
        taskSummary: request.task_summary,
        requiredSkills: request.required_skills,
        candidateAgentIds: request.candidate_agent_ids,
        agents: input.agents,
        events,
        now: input.now?.(),
      });
    },
    async recommendWithHydraEvidence(request: {
      buyer_id: string;
      task_summary: string;
      required_skills: string[];
      candidate_agent_ids?: string[];
      request_id?: string;
    }): Promise<HydraGroundedRecommendation> {
      if (!input.retrievalClient) throw new Error("HydraDB personalized retrieval client is required.");
      const recommendation = this.recommend(request);
      const query = `${request.task_summary}\nRequired skills: ${request.required_skills.join(", ")}`;
      const sharedResult = await input.retrievalClient.recallKnowledge({
        tenantId: input.tenantId,
        subTenantId: SHARED_COLLECTION,
        query,
        mode: "thinking",
        queryBy: "hybrid",
        recencyBias: 0.8,
        graphContext: true,
        queryApps: true,
      });
      const personalizedResult = await input.retrievalClient.recallPersonalized({
        tenantId: input.tenantId,
        subTenantId: request.buyer_id,
        query,
        mode: "thinking",
        queryBy: "hybrid",
        recencyBias: 0.8,
        graphContext: true,
        queryApps: true,
      });
      const chunksFrom = (result: unknown): unknown[] => result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).chunks)
        ? (result as { chunks: unknown[] }).chunks : [];
      const sharedChunks = chunksFrom(sharedResult);
      const personalizedChunks = chunksFrom(personalizedResult);
      const sourceIdFromChunk = (chunk: unknown): string | undefined => {
        if (!chunk || typeof chunk !== "object") return undefined;
        const record = chunk as Record<string, unknown>;
        for (const value of [record.source_id, record.sourceId, record.id]) if (typeof value === "string") return value;
        const source = record.source;
        if (source && typeof source === "object" && typeof (source as Record<string, unknown>).id === "string") return (source as Record<string, unknown>).id as string;
        return undefined;
      };
      const orderedUniqueIds = (chunks: unknown[], excluded = new Set<string>()): string[] => {
        const ids: string[] = [];
        for (const chunk of chunks) {
          const id = sourceIdFromChunk(chunk);
          if (id && !excluded.has(id)) { excluded.add(id); ids.push(id); }
        }
        return ids;
      };
      // Each lane retains HydraDB server rank. Shared knowledge is first; the
      // personalized lane contributes diagnostics after it, without duplicates.
      const seenSourceIds = new Set<string>();
      const sharedSourceIds = orderedUniqueIds(sharedChunks, seenSourceIds);
      const personalizedSourceIds = orderedUniqueIds(personalizedChunks, seenSourceIds);
      const sourceIds = [...sharedSourceIds, ...personalizedSourceIds];
      const eventById = new Map(events.map((event) => [event.trust_event_id, event]));
      const matchedIds = sharedSourceIds.filter((id) => eventById.has(id));
      recommendation.evidence = matchedIds.map((id) => eventById.get(id)!).filter((event) => !Number.isNaN(Date.parse(event.timestamp))).map((event) => ({
        evidence_id: event.trust_event_id,
        summary: event.summary,
        source: event.source,
        observed_at: event.timestamp,
      }));
      return {
        recommendation,
        retrieval: {
          returned_chunk_count: sharedChunks.length + personalizedChunks.length,
          shared_knowledge_chunk_count: sharedChunks.length,
          personalized_chunk_count: personalizedChunks.length,
          returned_source_ids: sourceIds,
          matched_trust_event_ids: matchedIds,
          unmatched_source_ids: sourceIds.filter((id) => !eventById.has(id)),
        },
      };
    },
  };
}
