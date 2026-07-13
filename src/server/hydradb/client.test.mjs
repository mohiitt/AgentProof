import assert from "node:assert/strict";
import { test } from "vitest";
import {
  HydraDbConfigurationError,
  HydraDbHttpError,
  HydraDbProcessingError,
  HydraDbPollingTimeoutError,
  createHydraDbClient,
  readHydraDbConfig,
} from "./client.ts";

function response(data, status = 200, options = {}) {
  const body = options.raw ?? {
    success: options.success ?? (status >= 200 && status < 300),
    data,
    error: options.error ?? null,
    meta: { request_id: options.requestId ?? "req-test" },
  };
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function configuredClient(transport, retry) {
  return createHydraDbClient({
    config: readHydraDbConfig({
      HYDRA_DB_ENABLED: "true",
      HYDRA_DB_API_KEY: "test-key",
      HYDRA_DB_DATABASE_ID: "agentproof_demo",
    }),
    fetch: transport,
    retry,
  });
}

test("configuration is explicit and credential-free by default", async () => {
  const disabled = readHydraDbConfig({ HYDRA_DB_DATABASE_ID: "database_1" });
  assert.equal(disabled.databaseId, "database_1");
  assert.equal(disabled.liveEnabled, false);
  assert.throws(() => readHydraDbConfig({ HYDRA_DB_ENABLED: "true", HYDRA_DB_API_KEY: "key" }), HydraDbConfigurationError);
  await assert.rejects(
    createHydraDbClient({ config: disabled, fetch: async () => response({}) }).infrastructureStatus(),
    HydraDbConfigurationError,
  );
});

test("database, context, and unified query calls use the API v2 wire contract", async () => {
  const requests = [];
  const client = configuredClient(async (url, init) => {
    requests.push({ url, init });
    return response({ accepted: true });
  });
  const knowledge = {
    id: "evt-1",
    database: "agentproof_demo",
    collection: "default",
    title: "Batch evidence",
    type: "trust_event",
    timestamp: "2026-07-13T12:00:00.000Z",
    content: { text: "Agent B completed batch extraction." },
    tenant_metadata: { agent_id: "agent_b", skill_id: "batch_pdf_extraction" },
    additional_metadata: { source: "test" },
  };

  await client.createTenant({ tenantId: "database_2", tenantMetadataSchema: [{ name: "agent_id", data_type: "VARCHAR", max_length: 256, enable_match: true }] });
  await client.uploadKnowledge([knowledge]);
  await client.deleteKnowledge({ sourceIds: ["source-1"], subTenantId: "buyer_1" });
  await client.listKnowledge({ filters: { additional_metadata: { source: "agentproof_seed" } }, includeFields: ["title", "type", "additional_metadata"] });
  await client.addMemory({
    id: "buyer_preference_buyer_1",
    tenantId: "agentproof_demo",
    subTenantId: "buyer_1",
    text: "Prefer verified agents.",
    infer: true,
    tenantMetadata: { buyer_id: "buyer_1" },
  });
  await client.recallPersonalized({
    tenantId: "agentproof_demo",
    subTenantId: "buyer_1",
    query: "batch PDF evidence",
    queryApps: true,
    metadataFilters: { agent_id: "agent_b" },
  });

  assert.equal(requests[0].url, "https://api.hydradb.com/databases");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    database: "database_2",
    tenant_metadata_schema: [{ name: "agent_id", data_type: "VARCHAR", max_length: 256, enable_match: true }],
  });
  for (const request of requests) {
    assert.equal(request.init.headers.Authorization, "Bearer test-key");
    assert.equal(request.init.headers["API-Version"], "2");
  }
  assert.match(requests[1].url, /\/context\/ingest$/);
  assert.ok(requests[1].init.body instanceof FormData);
  assert.equal(requests[1].init.body.get("type"), "knowledge");
  assert.equal(requests[1].init.body.get("database"), "agentproof_demo");
  assert.equal(requests[1].init.body.get("collection"), "default");
  assert.equal(requests[1].init.body.get("upsert"), "true");
  assert.deepEqual(JSON.parse(requests[1].init.body.get("app_knowledge")), [knowledge]);
  assert.equal(requests[2].init.method, "DELETE");
  assert.deepEqual(JSON.parse(requests[2].init.body), { type: "knowledge", database: "agentproof_demo", collection: "buyer_1", ids: ["source-1"] });
  assert.match(requests[3].url, /\/context\/list$/);
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    database: "agentproof_demo",
    type: "knowledge",
    page: 1,
    page_size: 50,
    filters: { additional_metadata: { source: "agentproof_seed" } },
    include_fields: ["title", "type", "additional_metadata"],
  });
  assert.equal(requests[4].init.body.get("type"), "memory");
  assert.equal(requests[4].init.body.get("database"), "agentproof_demo");
  assert.equal(requests[4].init.body.get("collection"), "buyer_1");
  assert.deepEqual(JSON.parse(requests[4].init.body.get("memories")), [{
    id: "buyer_preference_buyer_1",
    text: "Prefer verified agents.",
    infer: true,
    tenant_metadata: JSON.stringify({ buyer_id: "buyer_1" }),
  }]);
  assert.match(requests[5].url, /\/query$/);
  assert.deepEqual(JSON.parse(requests[5].init.body), {
    database: "agentproof_demo",
    collection: "buyer_1",
    query: "batch PDF evidence",
    type: "all",
    query_by: "hybrid",
    mode: "thinking",
    recency_bias: 0.75,
    graph_context: true,
    query_apps: true,
    metadata_filters: { agent_id: "agent_b" },
  });
});

test("readiness and context polling unwrap data and honor searchable/terminal v2 statuses", async () => {
  let readyChecks = 0;
  const client = configuredClient(async (url) => {
    if (url.includes("/databases/status")) {
      readyChecks += 1;
      return response({ database: "agentproof_demo", infra: { ready_for_ingestion: readyChecks > 1 } });
    }
    return response({ statuses: [{ id: "evt-1", indexing_status: "processing" }] });
  });
  const ready = await client.waitUntilReady({ intervalMs: 0, timeoutMs: 50, sleep: async () => {} });
  assert.equal(ready.infra.ready_for_ingestion, true);
  assert.equal(readyChecks, 2);
  await assert.rejects(client.waitUntilProcessed({ sourceIds: ["evt-1"], timeoutMs: 0, sleep: async () => {} }), HydraDbPollingTimeoutError);

  const urls = [];
  let checks = 0;
  const processing = configuredClient(async (url) => {
    urls.push(url);
    checks += 1;
    return response({ statuses: [
      { id: "id-1", indexing_status: checks === 1 ? "processing" : "graph_creation" },
      { id: "id-2", indexing_status: checks === 1 ? "queued" : "completed" },
    ] });
  });
  await processing.waitUntilProcessed({ sourceIds: ["id-1", "id-2"], subTenantId: "buyer_1", intervalMs: 0, timeoutMs: 50, sleep: async () => {} });
  assert.match(urls[0], /database=agentproof_demo&collection=buyer_1&ids=id-1&ids=id-2/);
  assert.equal(checks, 2);

  for (const terminal of ["errored", "failed"]) {
    const failing = configuredClient(async () => response({ statuses: [{ id: "evt-1", indexing_status: terminal, error_message: "bad document" }] }));
    await assert.rejects(failing.waitUntilProcessed({ sourceIds: ["evt-1"] }), HydraDbProcessingError);
  }
});

test("only 429, 500, and 503 retry with bounded jitter, while errors retain request ids", async () => {
  const delays = [];
  let attempts = 0;
  const retrying = configuredClient(async () => {
    attempts += 1;
    return attempts < 3
      ? response(null, 503, { error: { code: "SERVICE_UNAVAILABLE" }, requestId: `req-${attempts}` })
      : response({ infra: { ready_for_ingestion: true } });
  }, { maxAttempts: 3, baseDelayMs: 10, sleep: async (delay) => delays.push(delay), random: () => 0 });
  await retrying.infrastructureStatus();
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 10]);

  let nonRetryAttempts = 0;
  const invalid = configuredClient(async () => {
    nonRetryAttempts += 1;
    return response(null, 422, { error: { code: "VALIDATION_ERROR" }, requestId: "req-invalid" });
  });
  await assert.rejects(invalid.verifyProcessing({ fileIds: ["evt-1"] }), (error) => {
    assert.ok(error instanceof HydraDbHttpError);
    assert.equal(error.requestId, "req-invalid");
    assert.match(error.message, /req-invalid/);
    return true;
  });
  assert.equal(nonRetryAttempts, 1);
});
