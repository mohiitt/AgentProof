import "dotenv/config";
import { fileURLToPath } from "node:url";

import { RocketRideClient, type PIPELINE_RESULT } from "rocketride";

import { mapEvent } from "../../lib/rocketride/mapEvent";
import { assertValidTrustEvent } from "../../lib/rocketride/validate";
import type { TrustEvent } from "../../types/contracts";
import type { RawMarketplaceEvent } from "../../types/rocketride";

const DEFAULT_LOCAL_URI = "http://localhost:5565";

const CLASSIFY_PIPE_PATH = fileURLToPath(
  new URL("../../../rocketride/pipelines/classify.pipe", import.meta.url),
);

/**
 * The SDK's own built-in default URI points at RocketRide Cloud
 * (CONST_DEFAULT_SERVICE). This project runs against the local engine only
 * (see rocketride/PLAN.md), so fall back to it explicitly -- but only when
 * ROCKETRIDE_URI genuinely isn't set, so the VS Code extension's own
 * .env-synced value (which may point elsewhere) still wins.
 */
function resolveUri(): string {
  return process.env.ROCKETRIDE_URI || DEFAULT_LOCAL_URI;
}

/**
 * The RocketRideClient constructor throws if no auth is available from
 * config/env/.env. Fail with an actionable message instead of the SDK's
 * generic error -- run "RocketRide: Connect to Server" in VS Code, which
 * auto-syncs ROCKETRIDE_URI and ROCKETRIDE_APIKEY into .env even for the
 * local engine.
 */
function requireAuth(): string {
  const key = process.env.ROCKETRIDE_APIKEY;
  if (!key) {
    throw new Error(
      "ROCKETRIDE_APIKEY is not set. In VS Code, run 'RocketRide: Connect to " +
        "Server' (Command Palette) -- it syncs ROCKETRIDE_URI and " +
        "ROCKETRIDE_APIKEY into .env automatically, including for the local " +
        "engine. See rocketride/PLAN.md for the connection checklist.",
    );
  }
  return key;
}

function extractTextField(result: PIPELINE_RESULT | undefined): string {
  if (!result) {
    throw new Error("RocketRide pipeline returned no result");
  }
  const textKey = Object.entries(result.result_types ?? {}).find(([, type]) => type === "text")?.[0];
  const value = textKey ? result[textKey] : undefined;
  const text = Array.isArray(value) ? value.join("") : value;
  if (typeof text !== "string") {
    throw new Error(
      `RocketRide pipeline result had no text field (result_types=${JSON.stringify(result.result_types)})`,
    );
  }
  return text;
}

/**
 * Health check: true if the local RocketRide engine is reachable and this
 * client can authenticate against it.
 */
export async function pingEngine(): Promise<boolean> {
  const auth = requireAuth();
  try {
    await RocketRideClient.withConnection({ uri: resolveUri(), auth }, async (client) => {
      await client.ping();
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs classify.pipe (webhook -> parse -> anonymize_text -> response_text)
 * for PII scrubbing only, then runs the deterministic mapEvent() classifier
 * in TypeScript on the result. See rocketride/pipelines/README.md for why
 * event_type -> edge_type/outcome classification is not duplicated as
 * pipeline JSON. This is the "real engine" upgrade path for R5 PII
 * detection; src/lib/rocketride/anonymize.ts + mapEvent() together already
 * cover the same job fully offline with a regex-based scrubber.
 *
 * UNVERIFIED: classify.pipe has not run against a live engine yet (see
 * rocketride/pipelines/README.md). In particular this assumes the
 * anonymize_text node's redaction output stays valid JSON when the input
 * was JSON text -- confirm once the engine is connected.
 */
export async function classifyEvent(rawEvent: RawMarketplaceEvent): Promise<TrustEvent[]> {
  const anonymizedText = await RocketRideClient.withConnection(
    { uri: resolveUri(), auth: requireAuth() },
    async (client) => {
      const { token } = await client.use({ filepath: CLASSIFY_PIPE_PATH, useExisting: true });
      const result = await client.send(token, JSON.stringify(rawEvent), undefined, "application/json");
      return extractTextField(result);
    },
  );

  const anonymizedEvent = JSON.parse(anonymizedText) as RawMarketplaceEvent;
  const events = mapEvent(anonymizedEvent);
  events.forEach(assertValidTrustEvent);
  return events;
}
