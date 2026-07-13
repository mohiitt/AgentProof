import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  TrustEventValidationError,
  createTrustService,
  ingestTrustEvent,
  ingestBuyerPreference,
  ingestReferenceKnowledge,
  mapAgentSkillClaimToKnowledge,
  mapAgentToKnowledge,
  mapBuyerPreferenceToMemory,
  mapSkillToKnowledge,
  mapTrustEventToKnowledge,
  validateTrustEvent,
} from "./service.ts";
import { buildTrustRecommendation } from "../../lib/trust/scoring.ts";
import { mapEvent } from "../../lib/rocketride/mapEvent.ts";

const load = (name) => JSON.parse(readFileSync(new URL(`../../../data/seed/${name}`, import.meta.url), "utf8"));
const loadRocketSample = (name) => JSON.parse(readFileSync(new URL(`../../../rocketride/samples/events/${name}`, import.meta.url), "utf8"));
const agents = load("agents.json");
const buyers = load("buyer-preferences.json");
const events = load("trust-events.json");
const claims = load("agent-skill-claims.json");
const skills = load("skills.json");
const rocketSamples = [
  "job_completed.sample.json",
  "job_disputed.sample.json",
  "late_delivery.sample.json",
  "refund_issued.sample.json",
  "repeat_hire.sample.json",
].map(loadRocketSample);
const NOW = new Date("2026-07-13T12:00:00.000Z");
const pdfSkills = ["pdf_ocr", "batch_pdf_extraction", "schema_mapping", "csv_generation", "data_validation"];

test("every declared agent skill has an explicit, separate claim record", () => {
  const expected = agents.flatMap((agent) => agent.claimed_skill_ids.map((skill_id) => `${agent.agent_id}:${skill_id}`)).sort();
  const actual = claims.map((claim) => `${claim.agent_id}:${claim.skill_id}`).sort();
  assert.deepEqual(actual, expected);
});

test("strict event validation mirrors the shared contract and maps hot metadata", () => {
  const valid = validateTrustEvent(events[0]);
  assert.equal(valid.trust_event_id, "evt_a_ocr_001");
  assert.throws(() => validateTrustEvent({ ...events[0], unexpected: true }), TrustEventValidationError);
  assert.throws(() => validateTrustEvent({ ...events[0], rating: 7 }), TrustEventValidationError);
  assert.throws(() => validateTrustEvent({ ...events[0], timestamp: "not-a-timestamp" }), TrustEventValidationError);
  assert.throws(() => validateTrustEvent({ ...events[0], timestamp: "2026-07-13" }), TrustEventValidationError);
  assert.throws(() => validateTrustEvent({ ...events[0], additional_context: [] }), TrustEventValidationError);

  const knowledge = mapTrustEventToKnowledge(events[4], "agentproof-demo");
  assert.equal(knowledge.database, "agentproof-demo");
  assert.equal(knowledge.collection, "default");
  assert.equal(knowledge.id, "evt_a_batch_fail_005");
  assert.match(knowledge.content.text, /recent|failed|missed/i);
  assert.equal(knowledge.tenant_metadata.agent_id, "agent_a");
  assert.equal(knowledge.tenant_metadata.edge_type, "FAILED_SKILL");
  assert.equal(knowledge.additional_metadata.job_id, "job_a_005");
  assert.equal("relations" in knowledge, false);
  const memory = mapBuyerPreferenceToMemory(buyers[0], "agentproof-demo");
  assert.equal(memory.subTenantId, "buyer_risk_averse");
  assert.equal(memory.id, "buyer_preference_buyer_risk_averse");
  assert.equal(memory.text, buyers[0].preference_text);
  assert.equal(memory.infer, true);
});

test("RocketRide sample outputs are accepted at the HydraDB ingestion boundary", () => {
  const mappedEvents = rocketSamples.flatMap(mapEvent);
  assert.equal(mappedEvents.length, rocketSamples.length);
  for (const event of mappedEvents) {
    const valid = validateTrustEvent(event);
    const knowledge = mapTrustEventToKnowledge(valid, "agentproof-demo");
    assert.equal(knowledge.collection, "default");
    assert.equal(knowledge.id, event.trust_event_id);
    assert.equal(knowledge.additional_metadata.source, "rocketride");
    assert.equal(knowledge.tenant_metadata.agent_id, event.agent_id);
    assert.equal(knowledge.tenant_metadata.skill_id, event.skill_id);
  }
});

test("reference mappings use stable IDs, the shared collection, and only declared hot metadata", async () => {
  const skill = mapSkillToKnowledge(skills[1], "agentproof-demo");
  const agent = mapAgentToKnowledge(agents[0], "agentproof-demo");
  const claim = mapAgentSkillClaimToKnowledge(claims[1], "agentproof-demo");
  assert.equal(skill.id, "skill_batch_pdf_extraction");
  assert.equal(agent.id, "agent_agent_a");
  assert.equal(claim.id, "agent_skill_claim_agent_a_batch_pdf_extraction");
  for (const item of [skill, agent, claim]) {
    assert.equal(item.collection, "default");
    assert.ok(item.content.text.length > 20);
    assert.equal(item.additional_metadata.source, "agentproof_seed");
  }
  assert.deepEqual(Object.keys(skill.tenant_metadata).sort(), ["risk_level", "skill_id"]);
  assert.deepEqual(Object.keys(agent.tenant_metadata).sort(), ["agent_id", "price_tier"]);
  assert.deepEqual(Object.keys(claim.tenant_metadata).sort(), ["agent_id", "skill_id"]);

  const calls = [];
  const result = await ingestReferenceKnowledge({
    database: "agentproof-demo", skills: skills.slice(0, 2), agents: agents.slice(0, 1), claims: claims.slice(0, 2),
    client: {
      uploadKnowledge: async (items) => { calls.push(["upload", items]); return { results: items.map((item) => ({ id: item.id })) }; },
      waitUntilProcessed: async (input) => calls.push(["wait", input]),
    },
  });
  assert.deepEqual(result.skillIds, ["skill_pdf_ocr", "skill_batch_pdf_extraction"]);
  assert.equal(calls.filter(([kind]) => kind === "upload").length, 3);
  assert.ok(calls.filter(([kind]) => kind === "wait").every(([, payload]) => payload.subTenantId === "default"));
});

test("canonical 500-PDF recommendation puts Agent B above higher-rated Agent A", () => {
  const recommendation = buildTrustRecommendation({
    requestId: "canonical-500-pdf",
    buyer: buyers.find((buyer) => buyer.buyer_id === "buyer_risk_averse"),
    taskSummary: "Extract structured data from 500 PDFs into a clean CSV.",
    requiredSkills: pdfSkills,
    agents,
    events,
    now: NOW,
  });
  assert.equal(recommendation.best_agent_or_team[0], "agent_b");
  assert.ok(recommendation.avoid_agents.some((agent) => agent.agent_id === "agent_a"));
  assert.match(recommendation.reasoning_summary, /incident penalties/);
});

test("buyer preferences and candidate filters change the deterministic result", () => {
  const priceBuyer = buyers.find((buyer) => buyer.buyer_id === "buyer_price_sensitive");
  const priceRecommendation = buildTrustRecommendation({
    requestId: "price-500-pdf",
    buyer: priceBuyer,
    taskSummary: "Extract structured data from 500 PDFs into a clean CSV.",
    requiredSkills: pdfSkills,
    agents,
    events,
    now: NOW,
  });
  assert.ok(priceRecommendation.recommended_agents.some((agent) => agent.agent_id === "agent_c"));
  const riskRecommendation = buildTrustRecommendation({
    requestId: "risk-500-pdf",
    buyer: buyers.find((buyer) => buyer.buyer_id === "buyer_risk_averse"),
    taskSummary: "Extract structured data from 500 PDFs into a clean CSV.",
    requiredSkills: pdfSkills,
    agents,
    events,
    now: NOW,
  });
  assert.ok(riskRecommendation.avoid_agents.some((agent) => agent.agent_id === "agent_c"));
  const filtered = buildTrustRecommendation({
    requestId: "filtered",
    buyer: priceBuyer,
    taskSummary: "Extract structured data from 500 PDFs into a clean CSV.",
    requiredSkills: pdfSkills,
    candidateAgentIds: ["agent_a", "agent_b"],
    agents,
    events,
    now: NOW,
  });
  assert.equal(filtered.best_agent_or_team[0], "agent_b");
  assert.deepEqual([...filtered.recommended_agents, ...filtered.warn_agents, ...filtered.avoid_agents].map((agent) => agent.agent_id).sort(), ["agent_a", "agent_b"]);
});

test("ingestion validates, calls the Hydra boundary, and new evidence changes a later recommendation", async () => {
  const calls = [];
  const client = {
    uploadKnowledge: async (items) => { calls.push(["upload", items]); return { results: [{ id: "hydra-source-new" }] }; },
    waitUntilProcessed: async (input) => calls.push(["verify", input]),
  };
  const service = createTrustService({
    tenantId: "agentproof-demo",
    buyers,
    agents,
    events,
    client,
    now: () => NOW,
  });
  const before = service.recommend({
    buyer_id: "buyer_price_sensitive",
    task_summary: "Extract structured data from 500 PDFs into a clean CSV.",
    required_skills: pdfSkills,
  });
  assert.ok(before.recommended_agents.some((agent) => agent.agent_id === "agent_c"));
  const newFailure = {
    ...events[11],
    trust_event_id: "evt_c_batch_failure_new",
    job_id: "job_c_failure_new",
    buyer_id: "buyer_price_sensitive",
    outcome: "failed",
    edge_type: "FAILED_SKILL",
    rating: 1.5,
    dispute_status: "resolved",
    arbitration_outcome: "buyer",
    summary: "New 500-PDF batch missed required files.",
    reason: "Final manifest was incomplete.",
    timestamp: "2026-07-12T12:00:00.000Z",
  };
  await service.ingest(newFailure);
  assert.equal(calls[0][0], "upload");
  assert.deepEqual(calls[1][1].sourceIds, ["hydra-source-new"]);
  const after = service.recommend({
    buyer_id: "buyer_price_sensitive",
    task_summary: "Extract structured data from 500 PDFs into a clean CSV.",
    required_skills: pdfSkills,
  });
  assert.ok(after.warn_agents.some((agent) => agent.agent_id === "agent_c"));

  const directClient = { uploadKnowledge: async () => ({ results: [{ id: "hydra-source-direct" }] }), waitUntilProcessed: async () => {} };
  const direct = await ingestTrustEvent({ event: events[0], tenantId: "agentproof-demo", client: directClient });
  assert.equal(direct.id, events[0].trust_event_id);
  let memoryPayload;
  await ingestBuyerPreference({
    buyer: buyers[0],
    tenantId: "agentproof-demo",
    client: { addMemory: async (payload) => { memoryPayload = payload; } },
  });
  assert.equal(memoryPayload.infer, true);
  assert.equal(memoryPayload.text, buyers[0].preference_text);
});

test("Hydra-backed recommendation queries buyer all-scope and grounds evidence in returned chunk order", async () => {
  const calls = [];
  const service = createTrustService({
    tenantId: "agentproof-demo", buyers, agents, events, now: () => NOW,
    retrievalClient: {
      recallKnowledge: async (input) => {
        calls.push(["knowledge", input]);
        return { chunks: [
          { source_id: "evt_b_repeat_103" },
          { source: { id: "evt_b_batch_101" } },
          { source_id: "evt_b_repeat_103" },
        ] };
      },
      recallPersonalized: async (input) => {
        calls.push(["personalized", input]);
        return { chunks: [
          { source_id: "buyer_preference_buyer_risk_averse" },
          { source_id: "evt_b_repeat_103" },
        ] };
      },
    },
  });
  const result = await service.recommendWithHydraEvidence({
    buyer_id: "buyer_risk_averse",
    task_summary: "Extract structured data from 500 PDFs into a clean CSV.",
    required_skills: pdfSkills,
  });
  assert.equal(calls[0][0], "knowledge");
  assert.equal(calls[0][1].subTenantId, "default");
  assert.equal(calls[1][0], "personalized");
  assert.equal(calls[1][1].subTenantId, "buyer_risk_averse");
  assert.equal(calls[1][1].mode, "thinking");
  assert.deepEqual(result.recommendation.evidence.map((item) => item.evidence_id), ["evt_b_repeat_103", "evt_b_batch_101"]);
  assert.equal(result.recommendation.evidence[0].observed_at, events.find((event) => event.trust_event_id === "evt_b_repeat_103").timestamp);
  assert.deepEqual(result.retrieval.unmatched_source_ids, ["buyer_preference_buyer_risk_averse"]);
  assert.deepEqual(result.retrieval.returned_source_ids, ["evt_b_repeat_103", "evt_b_batch_101", "buyer_preference_buyer_risk_averse"]);
  assert.equal(result.retrieval.returned_chunk_count, 5);
  assert.equal(result.retrieval.shared_knowledge_chunk_count, 3);
  assert.equal(result.retrieval.personalized_chunk_count, 2);

  const failing = createTrustService({
    tenantId: "agentproof-demo", buyers, agents, events,
    retrievalClient: {
      recallKnowledge: async () => { throw new Error("shared query failed"); },
      recallPersonalized: async () => ({ chunks: [] }),
    },
  });
  await assert.rejects(failing.recommendWithHydraEvidence({
    buyer_id: "buyer_risk_averse", task_summary: "PDF job", required_skills: ["pdf_ocr"],
  }), /shared query failed/);

  const personalizedFailing = createTrustService({
    tenantId: "agentproof-demo", buyers, agents, events,
    retrievalClient: {
      recallKnowledge: async () => ({ chunks: [] }),
      recallPersonalized: async () => { throw new Error("personalized query failed"); },
    },
  });
  await assert.rejects(personalizedFailing.recommendWithHydraEvidence({
    buyer_id: "buyer_risk_averse", task_summary: "PDF job", required_skills: ["pdf_ocr"],
  }), /personalized query failed/);
});
