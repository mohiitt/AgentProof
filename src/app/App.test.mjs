import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { test } from "vitest";

import { extractSkills } from "../lib/rocketride/extractSkills.ts";
import { buildTrustRecommendation } from "../lib/trust/scoring.ts";
import {
  buildBuyerMemoryRows,
  buildClaimProofSummaries,
  buildScoreAudits,
  buildTrustJourney,
  hydraDbProofCards,
  INITIAL_APP_VIEW,
  landingPipelineFrames,
  landingActionTarget,
  rankedAgents,
} from "./App.tsx";

const root = new URL("../../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const buyers = readJson("data/seed/buyer-preferences.json");
const agents = readJson("data/seed/agents.json");
const events = readJson("data/seed/trust-events.json");
const recommendationSchema = readJson("contracts/trust_recommendation_schema.json");
const now = new Date("2026-07-13T12:00:00.000Z");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRecommendation = ajv.compile(recommendationSchema);

function recommend(task, buyerId) {
  const requiredSkills = extractSkills(task);
  assert.ok(requiredSkills.length > 0);
  const recommendation = buildTrustRecommendation({
    requestId: `ui-test-${buyerId}`,
    buyer: buyers.find((buyer) => buyer.buyer_id === buyerId),
    taskSummary: task,
    requiredSkills,
    agents,
    events,
    now,
  });
  assert.equal(validateRecommendation(recommendation), true, JSON.stringify(validateRecommendation.errors));
  return recommendation;
}

test("interactive PDF demo proves skill evidence beats the higher global rating", () => {
  const result = recommend(
    "Extract structured data from 500 PDFs into a clean, validated CSV.",
    "buyer_risk_averse",
  );
  assert.equal(result.best_agent_or_team[0], "agent_b");
  assert.ok(result.avoid_agents.some((agent) => agent.agent_id === "agent_a"));
  assert.deepEqual(rankedAgents(result).map((agent) => agent.agent_id), ["agent_b", "agent_d", "agent_c", "agent_a"]);
});

test("landing page is the first view and CTA targets the existing demo", () => {
  assert.equal(INITIAL_APP_VIEW, "landing");
  assert.equal(landingActionTarget("launch-demo"), "demo");
  assert.equal(landingActionTarget("view-proof"), "#hydradb-proof");
});

test("HydraDB proof gallery includes all four supplied proof surfaces", () => {
  assert.deepEqual(hydraDbProofCards.map((card) => card.id), [
    "api-logs",
    "database-totals",
    "knowledge-graph",
    "indexed-context",
  ]);
  for (const card of hydraDbProofCards) {
    assert.match(card.title, /\S/);
    assert.match(card.caption, /HydraDB|trust|graph|database|context/i);
    assert.equal(existsSync(new URL(`../../public${card.imageSrc}`, import.meta.url)), true, `${card.imageSrc} should exist`);
  }
});

test("landing flowchart shows input, RocketRide, HydraDB, and recommendation", () => {
  assert.deepEqual(landingPipelineFrames.map((frame) => frame.id), [
    "input",
    "rocketride",
    "hydradb",
    "recommendation",
  ]);
  const rocketrideFrame = landingPipelineFrames.find((frame) => frame.id === "rocketride");
  const hydradbFrame = landingPipelineFrames.find((frame) => frame.id === "hydradb");
  const recommendationFrame = landingPipelineFrames.at(-1);
  assert.equal(landingPipelineFrames[0].system, "Input");
  assert.ok(rocketrideFrame?.state.includes("Decomposing"));
  assert.ok(hydradbFrame?.output.includes("46 knowledge"));
  assert.ok(recommendationFrame?.output.includes("Hire"));
});

test("interactive buyer switch changes Agent C from avoid to recommended", () => {
  const task = "Extract structured data from 500 PDFs into a clean, validated CSV.";
  const riskAverse = recommend(task, "buyer_risk_averse");
  const priceSensitive = recommend(task, "buyer_price_sensitive");
  assert.ok(riskAverse.avoid_agents.some((agent) => agent.agent_id === "agent_c"));
  assert.ok(priceSensitive.recommended_agents.some((agent) => agent.agent_id === "agent_c"));
});

test("interactive research example resolves the research agent", () => {
  const result = recommend(
    "Research the market using primary web sources and check every citation.",
    "buyer_risk_averse",
  );
  assert.equal(result.best_agent_or_team[0], "agent_d");
});

test("trust journey exposes RocketRide, HydraDB, scoring, and recommendation stages", () => {
  const task = "Extract structured data from 500 PDFs into a clean, validated CSV.";
  const buyer = buyers.find((candidate) => candidate.buyer_id === "buyer_risk_averse");
  const requiredSkillIds = extractSkills(task);
  const recommendation = recommend(task, buyer.buyer_id);
  const journey = buildTrustJourney({ task, requiredSkillIds, buyer, recommendation });

  assert.deepEqual(journey.map((step) => step.id), ["rocketride", "hydradb", "scoring", "recommendation"]);
  assert.equal(journey[0].system, "RocketRide");
  assert.equal(journey[1].system, "HydraDB");
  assert.match(journey[1].summary, /trust events/);
  assert.match(journey[2].detail, /Agent B/);
  assert.match(journey[2].detail, /Agent A/);
  assert.match(journey[3].summary, /Agent B/);
});

test("score audit and claim proof data explain Agent B over Agent A", () => {
  const task = "Extract structured data from 500 PDFs into a clean, validated CSV.";
  const buyer = buyers.find((candidate) => candidate.buyer_id === "buyer_risk_averse");
  const requiredSkillIds = extractSkills(task);
  const recommendation = recommend(task, buyer.buyer_id);
  const audits = buildScoreAudits({ buyer, requiredSkillIds, recommendation });
  const claims = buildClaimProofSummaries(requiredSkillIds);

  assert.deepEqual(audits.map((audit) => audit.agent_id), ["agent_b", "agent_a"]);
  assert.ok(audits[0].breakdown.some((item) => item.label === "Skill evidence" && item.value > 0));
  assert.ok(audits[1].incidents > 0);
  assert.ok(claims.find((claim) => claim.agent_id === "agent_a").incidents > 0);
  assert.ok(claims.find((claim) => claim.agent_id === "agent_b").proven_successes > 0);
});

test("buyer memory rows expose price-sensitive budget alternative", () => {
  const task = "Extract structured data from 500 PDFs into a clean, validated CSV.";
  const rows = buildBuyerMemoryRows(task, extractSkills(task));
  const priceSensitive = rows.find((row) => row.buyer_id === "buyer_price_sensitive");

  assert.ok(priceSensitive);
  assert.equal(priceSensitive.budget_alternative.name, "Agent C — Circuit Budget");
  assert.equal(priceSensitive.budget_alternative.classification, "recommended");
  assert.ok(priceSensitive.budget_alternative.price_fit > priceSensitive.price_fit);
});
