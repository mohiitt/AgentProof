import assert from "node:assert/strict";

import { test } from "vitest";

import { runHydraDbLiveRetrieve, runRocketRideLiveCheck } from "./status.ts";

test("HydraDB live retrieve reports not configured without secrets", async () => {
  const result = await runHydraDbLiveRetrieve({});

  assert.equal(result.tool, "HydraDB");
  assert.equal(result.status, "not_configured");
  assert.match(result.summary, /offline fallback active/);
  assert.equal(result.details.fallback_counts.trust_events, 16);
});

test("RocketRide live check reports fallback when local engine is unreachable", async () => {
  const result = await runRocketRideLiveCheck({ ROCKETRIDE_LOCAL_URI: "ws://localhost:5565" }, {}, async () => false);

  assert.equal(result.tool, "RocketRide");
  assert.equal(result.status, "offline_fallback");
  assert.match(result.summary, /deterministic local skill extraction/);
  assert.equal(result.details.trust_event_schema_compatible, true);
  assert.ok(result.details.resolved_skills.length > 0);
});

test("RocketRide live check reports connected when local endpoint is reachable", async () => {
  const result = await runRocketRideLiveCheck({ ROCKETRIDE_LOCAL_URI: "ws://localhost:5565" }, {}, async () => true);

  assert.equal(result.status, "connected");
  assert.equal(result.details.local_engine_reachable, true);
});
