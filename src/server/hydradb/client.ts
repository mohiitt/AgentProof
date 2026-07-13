/** Dependency-free HydraDB API v2 boundary. Product-facing tenant/subtenant
 * names are retained at the service seam and translated here to
 * database/collection, the canonical provider terminology. */

export interface HydraDbConfig {
  apiKey?: string;
  databaseId?: string;
  baseUrl: string;
  liveEnabled: boolean;
}

export interface HydraDbFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type HydraDbFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit },
) => Promise<HydraDbFetchResponse>;

export interface HydraTenantMetadataField {
  name: string;
  data_type: "VARCHAR";
  max_length: number;
  enable_match: boolean;
}

export interface HydraKnowledgeItem {
  id: string;
  database: string;
  collection: string;
  title: string;
  type: string;
  timestamp: string;
  content: { text: string };
  tenant_metadata: Record<string, unknown>;
  additional_metadata: Record<string, unknown>;
  relations?: { ids: string[]; properties?: Record<string, unknown> };
}

export interface HydraMemoryInput {
  id?: string;
  tenantId?: string;
  subTenantId?: string;
  title?: string;
  text: string;
  infer: boolean;
  tenantMetadata?: Record<string, unknown>;
  additionalMetadata?: Record<string, unknown>;
  relations?: { ids: string[] };
  upsert?: boolean;
}

export interface HydraRecallInput {
  query: string;
  tenantId: string;
  subTenantId?: string;
  mode?: "thinking" | "fast";
  queryBy?: "hybrid" | "text";
  recencyBias?: number;
  graphContext?: boolean;
  queryApps?: boolean;
  metadataFilters?: Record<string, unknown>;
  maxResults?: number;
}

export interface HydraDbClient {
  createTenant(input: { tenantId: string; tenantMetadataSchema: HydraTenantMetadataField[] }): Promise<unknown>;
  infrastructureStatus(tenantId?: string): Promise<HydraInfrastructureStatus>;
  waitUntilReady(options?: HydraPollingOptions): Promise<HydraInfrastructureStatus>;
  uploadKnowledge(items: HydraKnowledgeItem[]): Promise<unknown>;
  deleteKnowledge(input: { sourceIds: string[]; tenantId?: string; subTenantId?: string }): Promise<unknown>;
  listKnowledge(input?: {
    tenantId?: string;
    subTenantId?: string;
    page?: number;
    pageSize?: number;
    filters?: Record<string, unknown>;
    includeFields?: string[];
  }): Promise<unknown>;
  verifyProcessing(input: { fileIds: string[]; tenantId?: string; subTenantId?: string }): Promise<unknown>;
  waitUntilProcessed(input: {
    sourceIds: string[];
    tenantId?: string;
    subTenantId?: string;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  }): Promise<unknown>;
  addMemory(input: HydraMemoryInput): Promise<unknown>;
  recallKnowledge(input: HydraRecallInput): Promise<unknown>;
  recallBuyerMemories(input: HydraRecallInput): Promise<unknown>;
  recallPersonalized(input: HydraRecallInput): Promise<unknown>;
}

export interface HydraInfrastructureStatus {
  database?: string;
  infra: {
    ready_for_ingestion: boolean;
    scheduler_status?: boolean;
    graph_status?: boolean;
    vectorstore_status?: unknown;
  };
  scheduler_status: boolean;
  graph_status: boolean;
  memories_vectorstore_status: boolean;
  knowledge_vectorstore_status: boolean;
  [key: string]: unknown;
}

export interface HydraPollingOptions {
  tenantId?: string;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface HydraRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class HydraDbConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HydraDbConfigurationError";
  }
}

export class HydraDbHttpError extends Error {
  public readonly endpoint: string;
  public readonly status: number;
  public readonly responseBody: string;
  public readonly requestId?: string;

  constructor(endpoint: string, status: number, responseBody: string, requestId?: string) {
    super(`HydraDB ${endpoint} failed with HTTP ${status}${requestId ? ` (request ${requestId})` : ""}: ${responseBody || "empty response"}`);
    this.name = "HydraDbHttpError";
    this.endpoint = endpoint;
    this.status = status;
    this.responseBody = responseBody;
    this.requestId = requestId;
  }
}

export class HydraDbPollingTimeoutError extends Error {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`HydraDB ${operation} did not complete within ${timeoutMs}ms.`);
    this.name = "HydraDbPollingTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export interface HydraProcessingStatus {
  id: string;
  indexing_status: string;
  error_code?: string | null;
  error_message?: string | null;
  message?: string | null;
}

export class HydraDbProcessingError extends Error {
  public readonly statuses: HydraProcessingStatus[];

  constructor(statuses: HydraProcessingStatus[]) {
    super(`HydraDB processing failed: ${statuses.map((status) => `${status.id}: ${status.error_message || status.message || status.error_code || "unknown error"}`).join("; ")}`);
    this.name = "HydraDbProcessingError";
    this.statuses = statuses;
  }
}

export function readHydraDbConfig(env: Record<string, string | undefined> = {}): HydraDbConfig {
  const apiKey = env.HYDRA_DB_API_KEY;
  const databaseId = env.HYDRA_DB_DATABASE_ID;
  const liveEnabled = env.HYDRA_DB_ENABLED === "true";
  if (liveEnabled && !apiKey) throw new HydraDbConfigurationError("HYDRA_DB_ENABLED=true requires HYDRA_DB_API_KEY.");
  if (liveEnabled && !databaseId) throw new HydraDbConfigurationError("HYDRA_DB_ENABLED=true requires HYDRA_DB_DATABASE_ID.");
  return { apiKey, databaseId, baseUrl: env.HYDRA_DB_BASE_URL || "https://api.hydradb.com", liveEnabled };
}

export function readHydraDbConfigFromRuntime(): HydraDbConfig {
  const runtime = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return readHydraDbConfig(runtime.process?.env || {});
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseJsonOrText(text: string): unknown {
  if (!text) return {};
  try { return JSON.parse(text) as unknown; } catch { return { raw: text }; }
}

function requestIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const meta = (value as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object") return undefined;
  return typeof (meta as Record<string, unknown>).request_id === "string"
    ? (meta as Record<string, unknown>).request_id as string
    : undefined;
}

function unwrapEnvelope(endpoint: string, status: number, responseText: string): unknown {
  const value = parseJsonOrText(responseText);
  if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).success !== "boolean") {
    throw new HydraDbHttpError(endpoint, status, responseText, requestIdFrom(value));
  }
  const envelope = value as { success: boolean; data?: unknown };
  if (!envelope.success) throw new HydraDbHttpError(endpoint, status, responseText, requestIdFrom(value));
  return envelope.data ?? {};
}

function vectorstoreReady(value: unknown, key: "knowledge" | "memories"): boolean {
  if (!value || typeof value !== "object") return false;
  const status = (value as Record<string, unknown>)[key];
  if (status === true) return true;
  if (status && typeof status === "object") {
    const record = status as Record<string, unknown>;
    return record.ready === true || record.status === "ready" || record.status === "completed";
  }
  return false;
}

function asStatus(value: unknown): HydraInfrastructureStatus {
  if (!value || typeof value !== "object") throw new Error("HydraDB database status response was not an object.");
  const candidate = value as Record<string, unknown>;
  if (!candidate.infra || typeof candidate.infra !== "object") throw new Error("HydraDB database status response did not include infra.");
  const infra = candidate.infra as Record<string, unknown>;
  const ready = infra.ready_for_ingestion === true;
  const scheduler = infra.scheduler_status === true || ready;
  const graph = infra.graph_status === true || ready;
  const memories = vectorstoreReady(infra.vectorstore_status, "memories") || ready;
  const knowledge = vectorstoreReady(infra.vectorstore_status, "knowledge") || ready;
  return {
    ...candidate,
    infra: {
      ...infra,
      ready_for_ingestion: ready,
      scheduler_status: infra.scheduler_status as boolean | undefined,
      graph_status: infra.graph_status as boolean | undefined,
      vectorstore_status: infra.vectorstore_status,
    },
    scheduler_status: scheduler,
    graph_status: graph,
    memories_vectorstore_status: memories,
    knowledge_vectorstore_status: knowledge,
  } as HydraInfrastructureStatus;
}

function processingStatuses(value: unknown): HydraProcessingStatus[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).statuses)) {
    throw new Error("HydraDB context status response did not include statuses.");
  }
  return (value as { statuses: HydraProcessingStatus[] }).statuses;
}

function processingQuery(ids: string[], database: string, collection?: string): string {
  const query = new URLSearchParams({ database });
  if (collection) query.set("collection", collection);
  for (const id of ids) query.append("ids", id);
  return query.toString();
}

function validateRecallInput(input: HydraRecallInput): void {
  if (!input.query.trim()) throw new Error("HydraDB query requires a non-empty query.");
  if (input.recencyBias !== undefined && (input.recencyBias < 0 || input.recencyBias > 1)) {
    throw new Error("HydraDB recencyBias must be between 0 and 1.");
  }
}

export function createHydraDbClient(options: {
  config: HydraDbConfig;
  fetch?: HydraDbFetch;
  retry?: HydraRetryOptions;
}): HydraDbClient {
  const { config } = options;
  const transport = options.fetch;
  const retry = {
    maxAttempts: options.retry?.maxAttempts ?? 3,
    baseDelayMs: options.retry?.baseDelayMs ?? 250,
    sleep: options.retry?.sleep ?? defaultSleep,
    random: options.retry?.random ?? Math.random,
  };

  const requireConfig = (): { apiKey: string; databaseId: string; fetch: HydraDbFetch } => {
    if (!config.liveEnabled) throw new HydraDbConfigurationError("HydraDB live calls are disabled. Set HYDRA_DB_ENABLED=true explicitly before using the REST client.");
    if (!config.apiKey || !config.databaseId) throw new HydraDbConfigurationError("HydraDB API key and database id are required.");
    if (!transport) throw new HydraDbConfigurationError("No fetch transport was provided for the HydraDB client.");
    return { apiKey: config.apiKey, databaseId: config.databaseId, fetch: transport };
  };

  const request = async (
    endpoint: string,
    init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
  ): Promise<unknown> => {
    const ready = requireConfig();
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      const response = await ready.fetch(`${config.baseUrl.replace(/\/$/, "")}${endpoint}`, {
        ...init,
        headers: { Authorization: `Bearer ${ready.apiKey}`, "API-Version": "2", ...init.headers },
      });
      const responseText = await response.text();
      if (response.ok) return unwrapEnvelope(endpoint, response.status, responseText);
      if (![429, 500, 503].includes(response.status) || attempt === retry.maxAttempts) {
        throw new HydraDbHttpError(endpoint, response.status, responseText, requestIdFrom(parseJsonOrText(responseText)));
      }
      const exponential = retry.baseDelayMs * 2 ** (attempt - 1);
      await retry.sleep(Math.round(exponential * (0.5 + retry.random() * 0.5)));
    }
    throw new Error("HydraDB retry loop exhausted unexpectedly.");
  };

  const database = (provided?: string): string => provided || requireConfig().databaseId;
  const query = (input: HydraRecallInput, type: "knowledge" | "memory" | "all") => {
    validateRecallInput(input);
    return request("/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        database: input.tenantId,
        ...(input.subTenantId ? { collection: input.subTenantId } : {}),
        query: input.query,
        type,
        query_by: input.queryBy || "hybrid",
        mode: input.mode || "thinking",
        recency_bias: input.recencyBias ?? 0.75,
        graph_context: input.graphContext ?? true,
        ...(input.queryApps !== undefined ? { query_apps: input.queryApps } : {}),
        ...(input.metadataFilters ? { metadata_filters: input.metadataFilters } : {}),
        ...(input.maxResults !== undefined ? { max_results: input.maxResults } : {}),
      }),
    });
  };

  return {
    createTenant: ({ tenantId, tenantMetadataSchema }) => request("/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ database: tenantId, tenant_metadata_schema: tenantMetadataSchema }),
    }),

    infrastructureStatus: async (tenantId) => asStatus(await request(`/databases/status?${new URLSearchParams({ database: database(tenantId) })}`)),

    waitUntilReady: async ({ tenantId, intervalMs = 5_000, timeoutMs = 300_000, sleep = defaultSleep } = {}) => {
      const startedAt = Date.now();
      while (true) {
        const status = asStatus(await request(`/databases/status?${new URLSearchParams({ database: database(tenantId) })}`));
        if (status.infra.ready_for_ingestion) return status;
        if (Date.now() - startedAt >= timeoutMs) throw new HydraDbPollingTimeoutError("database readiness", timeoutMs);
        await sleep(intervalMs);
      }
    },

    uploadKnowledge: (items) => {
      if (!items.length) throw new Error("HydraDB knowledge ingestion requires at least one item.");
      const batchDatabase = items[0].database;
      const batchCollection = items[0].collection;
      if (!batchDatabase || items.some((item) => item.database !== batchDatabase)) throw new Error("HydraDB knowledge ingestion requires one consistent database per batch.");
      if (!batchCollection || items.some((item) => item.collection !== batchCollection)) throw new Error("HydraDB knowledge ingestion requires one consistent collection per batch.");
      if (items.some((item) => !item.id || !item.title || !item.timestamp || !item.content?.text?.trim())) throw new Error("HydraDB app knowledge requires id, title, timestamp, and content.text.");
      const form = new FormData();
      form.append("type", "knowledge");
      form.append("database", batchDatabase);
      form.append("collection", batchCollection);
      form.append("upsert", "true");
      form.append("app_knowledge", JSON.stringify(items));
      return request("/context/ingest", { method: "POST", body: form });
    },

    deleteKnowledge: ({ sourceIds, tenantId, subTenantId }) => {
      if (!sourceIds.length) throw new Error("HydraDB knowledge deletion requires source ids.");
      return request("/context", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "knowledge", database: database(tenantId), ...(subTenantId ? { collection: subTenantId } : {}), ids: sourceIds }),
      });
    },

    listKnowledge: ({ tenantId, subTenantId, page = 1, pageSize = 50, filters, includeFields } = {}) => request("/context/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        database: database(tenantId),
        ...(subTenantId ? { collection: subTenantId } : {}),
        type: "knowledge",
        page,
        page_size: pageSize,
        ...(filters ? { filters } : {}),
        ...(includeFields ? { include_fields: includeFields } : {}),
      }),
    }),

    verifyProcessing: ({ fileIds, tenantId, subTenantId }) => {
      if (!fileIds.length) throw new Error("HydraDB context status requires ids.");
      return request(`/context/status?${processingQuery(fileIds, database(tenantId), subTenantId)}`);
    },

    waitUntilProcessed: async ({ sourceIds, tenantId, subTenantId, intervalMs = 5_000, timeoutMs = 300_000, sleep = defaultSleep }) => {
      if (!sourceIds.length) throw new Error("HydraDB context status requires ids.");
      const startedAt = Date.now();
      while (true) {
        const result = await request(`/context/status?${processingQuery(sourceIds, database(tenantId), subTenantId)}`);
        const statuses = processingStatuses(result);
        const byId = new Map(statuses.map((status) => [status.id, status]));
        const requested = sourceIds.map((id) => byId.get(id));
        const failures = requested.filter((status): status is HydraProcessingStatus => Boolean(status && ["errored", "failed"].includes(status.indexing_status)));
        if (failures.length) throw new HydraDbProcessingError(failures);
        if (requested.every((status) => status && ["graph_creation", "completed"].includes(status.indexing_status))) return result;
        if (Date.now() - startedAt >= timeoutMs) throw new HydraDbPollingTimeoutError("context processing", timeoutMs);
        await sleep(intervalMs);
      }
    },

    addMemory: (input) => {
      if (!input.text.trim()) throw new Error("HydraDB memory ingestion requires non-empty text.");
      if (!input.subTenantId) throw new Error("HydraDB memory ingestion requires a collection.");
      const form = new FormData();
      form.append("type", "memory");
      form.append("database", database(input.tenantId));
      form.append("collection", input.subTenantId);
      form.append("upsert", String(input.upsert ?? true));
      form.append("memories", JSON.stringify([{
        ...(input.id ? { id: input.id } : {}),
        ...(input.title ? { title: input.title } : {}),
        text: input.text,
        infer: input.infer,
        ...(input.tenantMetadata ? { tenant_metadata: JSON.stringify(input.tenantMetadata) } : {}),
        ...(input.additionalMetadata ? { additional_metadata: input.additionalMetadata } : {}),
        ...(input.relations ? { relations: input.relations } : {}),
      }]));
      return request("/context/ingest", { method: "POST", body: form });
    },

    recallKnowledge: (input) => query(input, "knowledge"),
    recallBuyerMemories: (input) => query(input, "memory"),
    recallPersonalized: (input) => query(input, "all"),
  };
}
