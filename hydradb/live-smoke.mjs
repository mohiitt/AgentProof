import { readFileSync } from "node:fs";

import {
  HydraDbHttpError,
  createHydraDbClient,
  readHydraDbConfigFromRuntime,
} from "../src/server/hydradb/client.ts";
import {
  AGENTPROOF_TENANT_METADATA_SCHEMA,
  ingestReferenceKnowledge,
  mapBuyerPreferenceToMemory,
  mapTrustEventToKnowledge,
  validateTrustEvent,
} from "../src/server/trust/service.ts";

const rootUrl = new URL("../", import.meta.url);
const loadJson = (relativePath) => JSON.parse(readFileSync(new URL(relativePath, rootUrl), "utf8"));

const config = readHydraDbConfigFromRuntime();
const client = createHydraDbClient({ config, fetch: globalThis.fetch });
const tenantId = config.databaseId;

if (!tenantId) throw new Error("HYDRA_DB_DATABASE_ID is required.");

async function ensureTenantReady() {
  try {
    await client.infrastructureStatus(tenantId);
  } catch (error) {
    if (!(error instanceof HydraDbHttpError) || error.status !== 404) throw error;
    const created = await client.createTenant({
      tenantId,
      tenantMetadataSchema: AGENTPROOF_TENANT_METADATA_SCHEMA,
    });
    console.log("tenant_create", JSON.stringify(created));
  }

  const status = await client.waitUntilReady({ tenantId });
  console.log("tenant_ready", JSON.stringify({
    scheduler: status.scheduler_status,
    graph: status.graph_status,
    memories: status.memories_vectorstore_status,
    knowledge: status.knowledge_vectorstore_status,
  }));
}

function sourceIdsFromIngest(result, expectedCount) {
  if (!result || typeof result !== "object" || !Array.isArray(result.results)) {
    throw new Error("HydraDB upload response did not include results[].");
  }
  const sourceIds = result.results
    .map((item) => typeof item?.id === "string" ? item.id : undefined)
    .filter(Boolean);
  if (sourceIds.length !== expectedCount) {
    throw new Error(`HydraDB returned ${sourceIds.length} source IDs for ${expectedCount} uploaded items.`);
  }
  return sourceIds;
}

async function ingestTrustEvents() {
  const events = loadJson("data/seed/trust-events.json").map(validateTrustEvent);
  const knowledge = events.map((event) => mapTrustEventToKnowledge(event, tenantId));
  const result = await client.uploadKnowledge(knowledge);
  const sourceIds = sourceIdsFromIngest(result, knowledge.length);
  await client.waitUntilProcessed({ sourceIds, tenantId, subTenantId: "default" });
  console.log("trust_events_ingested", knowledge.length);
}

async function ingestReferenceData() {
  const result = await ingestReferenceKnowledge({
    database: tenantId,
    skills: loadJson("data/seed/skills.json"),
    agents: loadJson("data/seed/agents.json"),
    claims: loadJson("data/seed/agent-skill-claims.json"),
    client,
  });
  console.log("reference_data_ingested", JSON.stringify({
    skills: result.skillIds.length,
    agents: result.agentIds.length,
    claims: result.claimIds.length,
  }));
}

async function ingestBuyerPreferences() {
  const buyers = loadJson("data/seed/buyer-preferences.json");

  for (const buyer of buyers) {
    const memory = mapBuyerPreferenceToMemory(buyer, tenantId);
    const result = await client.addMemory(memory);
    const sourceIds = sourceIdsFromIngest(result, 1);
    await client.waitUntilProcessed({
      sourceIds,
      tenantId,
      subTenantId: buyer.buyer_id,
    });
  }

  console.log("buyer_preferences_ingested", buyers.length);
}

async function defaultScopeSourceIds() {
  const listing = await client.listKnowledge({
    tenantId,
    subTenantId: "default",
    pageSize: 100,
    includeFields: ["title", "type", "additional_metadata"],
  });
  const sources = listing && typeof listing === "object"
    ? (Array.isArray(listing.sources) ? listing.sources : Array.isArray(listing.items) ? listing.items : [])
    : [];
  const trustEventSources = sources.filter((source) => source?.type === "trust_event");
  const agentProofSources = sources.filter((source) => {
    const legacyMetadata = source?.document_metadata;
    const v2Metadata = source?.additional_metadata;
    return (legacyMetadata && typeof legacyMetadata === "object" && legacyMetadata.source === "agentproof_seed")
      || (v2Metadata && typeof v2Metadata === "object" && v2Metadata.source === "agentproof_seed");
  });
  const candidates = agentProofSources;
  console.log("default_scope_candidates", JSON.stringify({
    total: sources.length,
    trustEventType: trustEventSources.length,
    agentproofSeed: agentProofSources.length,
    deletionCandidates: candidates.length,
  }));
  const sourceIds = candidates
    .map((source) => typeof source?.id === "string" ? source.id : undefined)
    .filter(Boolean);
  if (sources.length !== 16 || sourceIds.length !== 16) {
    throw new Error(`Refusing cleanup: expected the default scope to contain exactly 16 AgentProof seed sources; found total=${sources.length}, candidates=${sourceIds.length}.`);
  }
  return sourceIds;
}

async function cleanupDefaultScope() {
  const sourceIds = await defaultScopeSourceIds();
  await client.deleteKnowledge({ sourceIds, tenantId, subTenantId: "default" });
  const listing = await client.listKnowledge({
    tenantId,
    subTenantId: "default",
    pageSize: 100,
    includeFields: ["additional_metadata"],
  });
  const remaining = listing && typeof listing === "object"
    ? (Array.isArray(listing.sources) ? listing.sources : Array.isArray(listing.items) ? listing.items : [])
    : [];
  if (remaining.length !== 0) throw new Error(`HydraDB cleanup left ${remaining.length} sources in the previously AgentProof-only default collection.`);
  console.log("default_scope_cleaned", sourceIds.length);
}

function listedSources(listing) {
  return listing && typeof listing === "object"
    ? (Array.isArray(listing.sources) ? listing.sources : Array.isArray(listing.items) ? listing.items : [])
    : [];
}

function sourceMetadata(source) {
  return source?.additional_metadata && typeof source.additional_metadata === "object"
    ? source.additional_metadata
    : source?.document_metadata && typeof source.document_metadata === "object" ? source.document_metadata : {};
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function validateKnowledgeDeletionResult(result, expectedCount, buyerId) {
  if (!result || typeof result !== "object") return;
  const records = [result, result.response, result.result, result.data]
    .filter((value) => value && typeof value === "object");
  for (const record of records) {
    if ("success" in record && record.success !== true) {
      throw new Error(`HydraDB reported unsuccessful knowledge deletion for ${buyerId}.`);
    }
    const deletedCount = typeof record.deleted_count === "number"
      ? record.deleted_count
      : typeof record.deletedCount === "number" ? record.deletedCount : undefined;
    if (deletedCount !== undefined && deletedCount !== expectedCount) {
      throw new Error(`HydraDB reported deleted_count=${deletedCount} for ${buyerId}; expected ${expectedCount}.`);
    }
  }
}

async function waitForKnowledgeIdsAbsent(buyerId, expected, timeoutMs = 60_000, intervalMs = 2_000) {
  const startedAt = Date.now();
  while (true) {
    const verification = listedSources(await client.listKnowledge({
      tenantId,
      subTenantId: buyerId,
      pageSize: 100,
      includeFields: ["additional_metadata"],
    }));
    const remaining = verification.filter((source) => expected.has(source?.id));
    if (remaining.length === 0) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Buyer-scope cleanup for ${buyerId} still exposed ${remaining.length} trust-event sources after ${timeoutMs}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function cleanupBuyerScopedTrustEvents() {
  const events = loadJson("data/seed/trust-events.json").map(validateTrustEvent);
  const byBuyer = Map.groupBy(events, (event) => event.buyer_id);
  let deleted = 0;
  for (const [buyerId, buyerEvents] of byBuyer) {
    const expected = new Set(buyerEvents.map((event) => event.trust_event_id));
    const listing = await client.listKnowledge({ tenantId, subTenantId: buyerId, pageSize: 100, includeFields: ["type", "additional_metadata"] });
    const sources = listedSources(listing);
    const seeded = sources.filter((source) => sourceMetadata(source).source === "agentproof_seed");
    const actual = new Set(seeded.map((source) => source?.id).filter(Boolean));
    if (actual.size === 0) {
      console.log("buyer_scoped_trust_events_already_clean", buyerId);
      continue;
    }
    if (!setsEqual(actual, expected)) {
      throw new Error(`Refusing buyer-scope cleanup for ${buyerId}: expected exactly ${expected.size} AgentProof seed sources matching the stable trust-event IDs, found ${actual.size}.`);
    }
    const deletion = await client.deleteKnowledge({ sourceIds: [...expected], tenantId, subTenantId: buyerId });
    validateKnowledgeDeletionResult(deletion, expected.size, buyerId);
    await waitForKnowledgeIdsAbsent(buyerId, expected);
    deleted += expected.size;
  }
  console.log("buyer_scoped_trust_events_cleaned", deleted);
}

async function verifyRecall() {
  const subTenantId = "buyer_risk_averse";
  const skill = await client.recallKnowledge({
    tenantId,
    subTenantId: "default",
    query: "batch PDF extraction missed files file coverage",
    mode: "thinking", queryApps: true,
  });
  const claim = await client.recallKnowledge({
    tenantId,
    subTenantId: "default",
    query: "Which agent claims batch_pdf_extraction verified delivery history?",
    mode: "thinking", queryApps: true,
  });
  const failure = await client.recallKnowledge({
    tenantId,
    subTenantId: "default",
    query: "evt_a_batch_fail_005",
    mode: "thinking",
    recencyBias: 0.8,
    graphContext: true,
    queryApps: true,
  });
  const memories = await client.recallBuyerMemories({
    tenantId,
    subTenantId,
    query: "How risk averse is this buyer and what failures should be avoided?",
    mode: "thinking",
    graphContext: true,
  });
  const combined = await client.recallPersonalized({
    tenantId,
    subTenantId,
    query: "Which agent is safest for 500-PDF batch extraction for this buyer?",
    mode: "thinking",
    recencyBias: 0.8,
    graphContext: true,
    queryApps: true,
  });
  const skillChunks = Array.isArray(skill?.chunks) ? skill.chunks.length : 0;
  const claimChunks = Array.isArray(claim?.chunks) ? claim.chunks.length : 0;
  const failureChunks = Array.isArray(failure?.chunks) ? failure.chunks.length : 0;
  const memoryChunks = Array.isArray(memories?.chunks) ? memories.chunks.length : 0;
  const combinedChunks = Array.isArray(combined?.chunks) ? combined.chunks.length : 0;
  if (skillChunks === 0 || claimChunks === 0 || failureChunks === 0 || memoryChunks === 0 || combinedChunks === 0) {
    console.log("recall_shape", JSON.stringify({
      skillChunks, claimChunks, failureChunks,
      memoryKeys: memories && typeof memories === "object" ? Object.keys(memories) : [],
      combinedKeys: combined && typeof combined === "object" ? Object.keys(combined) : [],
      memoryChunks,
      combinedChunks,
    }));
    throw new Error(`HydraDB query returned insufficient results: skill=${skillChunks}, claim=${claimChunks}, failure=${failureChunks}, memories=${memoryChunks}, all=${combinedChunks}.`);
  }
  console.log("query_verified", JSON.stringify({ skillChunks, claimChunks, failureChunks, memoryChunks, combinedChunks }));
}

await ensureTenantReady();
if (process.argv.includes("--audit-default")) {
  const sourceIds = await defaultScopeSourceIds();
  console.log("default_scope_audited", sourceIds.length);
} else if (process.argv.includes("--cleanup-default")) {
  await cleanupDefaultScope();
} else if (process.argv.includes("--cleanup-buyer-trust")) {
  await cleanupBuyerScopedTrustEvents();
} else if (!process.argv.includes("--recall-only")) {
  await ingestReferenceData();
  await ingestTrustEvents();
  await ingestBuyerPreferences();
  await verifyRecall();
} else {
  await verifyRecall();
}
