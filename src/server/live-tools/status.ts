import "dotenv/config";

import fs from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

import { RocketRideClient } from "rocketride";
import agentData from "../../../data/seed/agents.json";
import claimData from "../../../data/seed/agent-skill-claims.json";
import buyerData from "../../../data/seed/buyer-preferences.json";
import skillData from "../../../data/seed/skills.json";
import trustEventData from "../../../data/seed/trust-events.json";
import sampleTrustEvent from "../../../rocketride/samples/trust-event.sample.json";
import { extractSkills } from "../../lib/rocketride/extractSkills";
import { validateTrustEvent } from "../../lib/rocketride/validate";
import { createHydraDbClient, readHydraDbConfig } from "../hydradb/client";

export type LiveToolStatus = "connected" | "offline_fallback" | "not_configured" | "error";

export interface LiveToolCheckResponse {
  tool: "HydraDB" | "RocketRide";
  status: LiveToolStatus;
  summary: string;
  details: Record<string, unknown>;
  checked_at: string;
}

const fallbackCounts = {
  skills: skillData.length,
  agents: agentData.length,
  claims: claimData.length,
  trust_events: trustEventData.length,
  buyer_profiles: buyerData.length,
};

const EXTRACT_PIPE_PATH = fileURLToPath(new URL("../../../rocketride/pipelines/extract_skills.pipe", import.meta.url));

function checkedAt(): string {
  return new Date().toISOString();
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["results", "items", "contexts", "sources", "data", "chunks"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function countKnowledgeTypes(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of asArray(value)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
    const id = typeof record.id === "string" ? record.id : "";
    const title = typeof record.title === "string" ? record.title : "";
    const type = id.startsWith("evt_") || ("edge_type" in metadata && "outcome" in metadata)
      ? "trust_event"
      : id.startsWith("agent_skill_claim_")
        ? "agent_skill_claim"
        : id.startsWith("agent_agent_") || title.includes("agent profile")
          ? "agent_profile"
          : id.startsWith("skill_")
            ? "skill"
            : "unknown";
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

export async function runHydraDbLiveRetrieve(
  env: Record<string, string | undefined> = process.env,
  input: { buyerId?: string; task?: string; requiredSkillIds?: string[] } = {},
): Promise<LiveToolCheckResponse> {
  let config;
  try {
    config = readHydraDbConfig(env);
  } catch (error) {
    return {
      tool: "HydraDB",
      status: "not_configured",
      summary: "HydraDB offline fallback active - live config is incomplete; using committed seed mirror.",
      details: { fallback_counts: fallbackCounts, reason: error instanceof Error ? error.message : "unknown config error" },
      checked_at: checkedAt(),
    };
  }

  if (!config.liveEnabled) {
    return {
      tool: "HydraDB",
      status: "not_configured",
      summary: "HydraDB offline fallback active - HYDRA_DB_ENABLED is not true; using committed seed mirror.",
      details: { fallback_counts: fallbackCounts },
      checked_at: checkedAt(),
    };
  }

  try {
    const client = createHydraDbClient({
      config,
      fetch: globalThis.fetch,
      retry: { maxAttempts: 1 },
    });
    const tenantId = config.databaseId || "";
    const status = await client.waitUntilReady({ tenantId, intervalMs: 500, timeoutMs: 8_000 });
    const knowledge = await client.listKnowledge({ tenantId, subTenantId: "default", pageSize: 100 });
    const knowledgeCounts = countKnowledgeTypes(knowledge);
    const memory = await client.recallPersonalized({
      tenantId,
      subTenantId: input.buyerId || "buyer_risk_averse",
      query: [
        input.task || "buyer preference memory for high-volume PDF extraction risk",
        input.requiredSkillIds?.length ? `Required skills: ${input.requiredSkillIds.join(", ")}` : "",
      ].filter(Boolean).join("\n"),
      mode: "fast",
      queryBy: "hybrid",
      recencyBias: 0.8,
      graphContext: true,
      maxResults: 8,
    });
    const memoryCount = asArray(memory).length;
    return {
      tool: "HydraDB",
      status: "connected",
      summary: `HydraDB connected - verified readiness and retrieved ${knowledgeCounts.trust_event ?? 0} trust events, ${knowledgeCounts.agent_skill_claim ?? 0} claims, ${knowledgeCounts.agent_profile ?? 0} agents, ${knowledgeCounts.skill ?? 0} skills, and buyer memory.`,
      details: {
        database: tenantId,
        ready_for_ingestion: status.infra.ready_for_ingestion,
        retrieved_counts: knowledgeCounts,
        buyer_memory_chunks: memoryCount,
      },
      checked_at: checkedAt(),
    };
  } catch (error) {
    return {
      tool: "HydraDB",
      status: "error",
      summary: "HydraDB live check could not complete; offline seed mirror remains active.",
      details: {
        fallback_counts: fallbackCounts,
        reason: error instanceof Error ? error.message : "unknown HydraDB error",
      },
      checked_at: checkedAt(),
    };
  }
}

function localRocketRideUri(env: Record<string, string | undefined>): string {
  return env.ROCKETRIDE_LOCAL_URI || "ws://localhost:5565";
}

function rocketRideSdkUri(env: Record<string, string | undefined>): string | undefined {
  return env.ROCKETRIDE_URI || env.ROCKETRIDE_LOCAL_URI;
}

function parseHostPort(uri: string): { host: string; port: number } {
  const parsed = new URL(uri);
  const defaultPort = parsed.protocol === "https:" || parsed.protocol === "wss:" ? 443 : 80;
  return { host: parsed.hostname || "localhost", port: parsed.port ? Number(parsed.port) : defaultPort };
}

function canReach(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function runRocketRideLiveCheck(
  env: Record<string, string | undefined> = process.env,
  input: { task?: string } = {},
  reachability: (host: string, port: number) => Promise<boolean> = canReach,
): Promise<LiveToolCheckResponse> {
  const task = input.task || "Extract structured data from 500 PDFs into a clean, validated CSV.";
  const resolvedSkills = extractSkills(task);
  const schemaResult = validateTrustEvent(sampleTrustEvent);
  if (!schemaResult.valid) {
    return {
      tool: "RocketRide",
      status: "error",
      summary: "RocketRide fallback proof failed trust_event_schema validation.",
      details: { errors: schemaResult.errors },
      checked_at: checkedAt(),
    };
  }

  try {
    const localUri = localRocketRideUri(env);
    const { host, port } = parseHostPort(localUri);
    const reachable = await reachability(host, port);
    const sdkUri = rocketRideSdkUri(env);
    const auth = env.ROCKETRIDE_APIKEY;
    if (sdkUri && auth) {
      const pipeline = JSON.parse(fs.readFileSync(EXTRACT_PIPE_PATH, "utf8")) as Record<string, unknown>;
      const sdk = await RocketRideClient.withConnection({
        uri: sdkUri,
        auth,
        requestTimeout: 15_000,
      }, async (client) => {
        await client.ping();
        const services = await client.getServices();
        const validation = await client.validate({ pipeline: { pipeline } });
        const validationErrors = validation && typeof validation === "object" && Array.isArray((validation as Record<string, unknown>).errors)
          ? (validation as { errors: unknown[] }).errors.length
          : 0;
        return {
          uri: client.getConnectionInfo?.().uri || sdkUri,
          service_count: services && typeof services === "object" ? Object.keys(services).length : 0,
          pipeline_validation_errors: validationErrors,
        };
      });
      return {
        tool: "RocketRide",
        status: "connected",
        summary: `RocketRide connected - SDK ping succeeded, service catalog fetched, extract_skills.pipe validated, and ${resolvedSkills.length} skills were resolved for the brief.`,
        details: {
          sdk_uri: sdk.uri,
          local_uri: localUri,
          local_engine_reachable: reachable,
          service_count: sdk.service_count,
          pipeline_validation_errors: sdk.pipeline_validation_errors,
          resolved_skills: resolvedSkills,
          trust_event_schema_compatible: true,
        },
        checked_at: checkedAt(),
      };
    }
    return {
      tool: "RocketRide",
      status: reachable ? "connected" : "offline_fallback",
      summary: reachable
        ? `RocketRide local engine reachable - fallback proof resolved ${resolvedSkills.length} skills and validated trust_event_schema.json.`
        : `RocketRide offline fallback active - deterministic local skill extraction resolved ${resolvedSkills.length} skills and trust_event_schema.json is compatible.`,
      details: {
        local_uri: localUri,
        local_engine_reachable: reachable,
        sdk_configured: Boolean(sdkUri && auth),
        resolved_skills: resolvedSkills,
        trust_event_schema_compatible: true,
      },
      checked_at: checkedAt(),
    };
  } catch (error) {
    return {
      tool: "RocketRide",
      status: "error",
      summary: "RocketRide live proof check failed; deterministic fallback remains available.",
      details: {
        reason: error instanceof Error ? error.message : "unknown RocketRide check error",
        resolved_skills: resolvedSkills,
        trust_event_schema_compatible: true,
      },
      checked_at: checkedAt(),
    };
  }
}
