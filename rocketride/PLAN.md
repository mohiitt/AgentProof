# RocketRide Workstream — Implementation Plan (Claude Code)

Owner: teammate on `feature/rocketride-pipelines`. This plan covers **only** the
RocketRide side. It refines the phased plan in
`../AgentProof_Two_Person_Implementation_Plan.md` into concrete files, contracts,
and acceptance checks.

## Mission

Turn raw marketplace events (job completed / disputed / refund / late delivery /
repeat hire) into structured **trust events** that validate against
`../contracts/trust_event_schema.json`, plus a **skill-extraction** step that
turns a job brief into a required-skill list. HydraDB consumes both.

## Fixed integration contract

The `contracts/` schemas are the only shared surface and are treated as frozen
unless coordinated with the HydraDB owner:

- Input to my pipeline: `RawMarketplaceEvent` (`src/types/rocketride.ts`).
- Output of my pipeline: `TrustEvent[]` — must satisfy
  `contracts/trust_event_schema.json` byte-for-byte (enums, required keys,
  `additionalProperties: false`, `date-time` timestamp).
- Skill IDs I emit must match `contracts/skill_schema.json` IDs
  (`^[a-z0-9_]+$`) so HydraDB can join on them.

A JSON-Schema validation gate is the definition of "done" for every pipeline
output. Nothing leaves this workstream unvalidated.

## Ownership guardrails

Edit only: `rocketride/`, `src/server/rocketride/`, `src/lib/rocketride/`,
`src/types/rocketride.ts`. Never edit `hydradb/`, `src/server/trust/`,
`src/lib/trust/`, `src/types/hydradb.ts`, `data/seed/`. Changing any
`contracts/*.json` requires pinging the HydraDB owner and shipping updated
samples.

---

## RocketRide platform facts (from docs.rocketride.org)

RocketRide is an open-source runtime for AI pipelines: a directed graph of
components executed by a C++ core, runnable identically on a local engine, Docker,
or RocketRide Cloud. Confirmed specifics:

- **SDK:** `npm install rocketride`.
  `import { RocketRideClient, Question, Answer } from 'rocketride'`.
- **Runtime: LOCAL engine.** `ROCKETRIDE_URI=ws://localhost:5565` via the VS Code
  extension or Docker. No Cloud API key required for local runs.
- **`.pipe` file:** JSON with a `components[]` array; each component is
  `{ id, provider, config, input?: [{ lane, from }], control? }`, plus an
  optional top-level `control[]` for invoke connections. Data flows over typed
  **lanes** (e.g. `questions → answers`). Env vars interpolate as `${VAR}`.
- **Run:** SDK `await client.use({ filepath })` → `client.send(token, data, objinfo?, mimeType?)`;
  or `RocketRideClient.withConnection(cfg, async c => …)` for one-off scripts;
  or CLI `rocketride start --pipeline ./x.pipe`.
- **LLM node (Gemini):** RocketRide lists Gemini among its LLM providers. Node
  shape mirrors `llm_anthropic` → `provider: "llm_gemini"` (exact id to confirm
  from the Nodes reference at build time), `config: { profile, apikey: "${GEMINI_API_KEY}" }`,
  lanes `questions → answers`.

**LLM policy: one node, optional.** The LLM is used for **skill extraction only**
(R4) and has a deterministic keyword fallback. R3 event→TrustEvent is pure logic
with no LLM. So a missing API key degrades gracefully, never breaks the pipeline.

**Built-in nodes that cover my phases natively** (prefer these over custom code):

| Need | Built-in node |
| --- | --- |
| Ingest raw event | `webhook` source |
| R5 PII scrub | **Anonymize** (Text category) |
| R3 classify | deterministic mapper (no LLM) |
| R4 skills | `llm_gemini` + keyword fallback |
| Output validation | Guardrails (output) / local validator |
| R6 POST to HydraDB | HTTP Request tool |
| Emit result | `response` / Local Output |

### Still needed from the team

1. Local RocketRide engine running at `ws://localhost:5565` (VS Code extension or
   Docker). No `ROCKETRIDE_APIKEY` needed for local.
2. `GEMINI_API_KEY` — **only** for the R4 skill-extraction node; optional thanks
   to the keyword fallback. Add to `.env.local` + a commented line in `.env.example`.

**Not blocked while waiting:** R2 sample events, the `TrustEvent` mapper/
normalizer, the validator gate, R4's keyword fallback, and the R6 file-based
handoff are all pure and build + test with zero RocketRide/LLM access.

---

## Phase-by-phase

### R1 — RocketRide setup  *(needs local engine at ws://localhost:5565)*
- `npm install rocketride`; add to `package.json` deps.
- `src/server/rocketride/client.ts`: wrap `RocketRideClient` — read
  `ROCKETRIDE_URI` (default `ws://localhost:5565`) from env, expose a typed
  `runPipeline(pipePath, input): Promise<TrustEvent[]>` using
  `RocketRideClient.withConnection` → `use({ filepath })` → `send(token, json)`.
- `rocketride/pipelines/classify.pipe`: minimal `webhook → response` graph to
  prove the round trip before adding the LLM node.
- **Accept:** one pipeline runs (local engine or Cloud), accepts a sample event,
  returns structured output.

### R2 — Sample event corpus  *(unblocked)*
- Expand `rocketride/samples/` with one raw event per type: `job_completed`,
  `job_disputed`, `refund_issued`, `repeat_hire`, `late_delivery`.
- Each keyed to the canonical demo (500-PDF batch) so it drives the A-vs-B story.
- **Accept:** every event type has a representative raw sample.

### R3 — Event classification pipeline  *(deterministic, no LLM)*
- `.pipe` graph: `webhook → Anonymize → response`. No LLM on this path.
- `src/lib/rocketride/mapEvent.ts`: pure function
  `RawMarketplaceEvent → TrustEvent[]`. All contract fields are derived
  deterministically from the (authored) raw event: `edge_type`/`outcome` from a
  lookup table on `event_type` + `arbitration_outcome`; ids, timestamp,
  ratings, price_tier/complexity/sla passed through; `summary`/`reason`
  templated from the (anonymized) complaint text.
- Edge-type table, e.g.: `job_disputed`+buyer-favor → `DISPUTED_BY` /
  `RESOLVED_IN_FAVOR_OF_BUYER`; `late_delivery` → `DELIVERED_LATE`;
  `refund_issued` → `PARTIAL_REFUND`; `repeat_hire` → `REPEAT_HIRE`;
  `job_completed` → `CONFIRMED_BY` / `PASSED_SKILL`.
- SDK-independent so it's unit-testable; the `.pipe` mirrors it.
- **Accept:** raw event → valid structured trust event; different event types
  produce different `edge_type`s; all outputs pass the validator; zero API calls.

### R4 — Skill extraction pipeline  *(the one LLM node; unblocked via fallback)*
- `src/lib/rocketride/extractSkills.ts`: job brief → ordered `skill_id[]`.
- Primary: `.pipe` graph `webhook → llm_gemini → response`, LLM prompted to
  return only canonical `skill_id`s (constrained to the taxonomy) as JSON.
- Fallback: deterministic keyword/alias matcher over `skill_schema.json` so the
  demo runs with no `GEMINI_API_KEY`. Both paths post-filtered to valid IDs.
- Must return canonical IDs from `skill_schema.json`; the PDF demo brief must
  yield `pdf_ocr, batch_pdf_extraction, table_extraction, schema_mapping,
  csv_generation, data_validation`.
- **Accept:** brief → required skills; IDs align with the skill contract; works
  with and without the LLM key.

### R5 — PII / anonymization  *(unblocked)*
- Primary: the built-in **Anonymize** node in the R3 graph (before the LLM).
- Backup for the offline/file path: `src/lib/rocketride/anonymize.ts` strips
  emails, names, account IDs from free text, keeps enough for classification, and
  sets `additional_context.anonymized = true`.
- **Accept:** dispute text is safe to store; classification still works.

### R6 — Handoff to backend  *(unblocked via files; API needs HydraDB endpoint)*
- Primary: an **HTTP Request** tool node (or `client`-side POST) sends the
  validated `TrustEvent` to HydraDB's ingest endpoint (`VITE_API_BASE_URL`).
- Fallback (default until endpoint lands): write validated output to
  `rocketride/samples/out/*.json` for manual HydraDB ingest.
- **Accept:** output matches `trust_event_schema.json`; HydraDB owner ingests it
  without changing my code.

---

## Build order (mine)

1. R2 samples + R3 `mapEvent` + validator gate — the core value, fully offline.
2. R4 skill extraction.
3. R5 anonymization, folded into R3.
4. R1 real SDK wiring once creds arrive.
5. R6 endpoint POST once HydraDB exposes ingest; file fallback works from day 1.

## Validator gate

Add a lightweight JSON-Schema check (e.g. `ajv`) used by both a test and the
pipeline output step. Every `TrustEvent` and skill list is validated before it
is written or sent. This is the contract enforcement point.

## Status

**Done (offline core, no RocketRide engine or LLM key required):** R2 sample
events (all 5 types), R3 `mapEvent` (deterministic, contract-validated), R4
`extractSkills` keyword fallback, R5 `anonymizeText`, R6 file-based
`writeTrustEvent`. 23 tests passing; `tsc --noEmit` and `vite build` both
clean. `classify.pipe` / `extract_skills.pipe` are drafted but **unverified**
— no local engine has run them yet (see `pipelines/README.md` for the
placeholders that need confirming once the engine is up).

**Not started:** R1 real `RocketRideClient` wiring (needs local engine at
`ws://localhost:5565`), R6 HTTP handoff to a live HydraDB ingest endpoint.

### To communicate to Mohit (Rule 3 / shared-surface)

1. Added root-level dev dependencies for my own tests/build: `ajv`,
   `ajv-formats`, `vitest`, `@types/node`. Touched root `package.json`,
   `package-lock.json`, and `.gitignore` (not just my owned folders) — likely
   `package-lock.json` merge friction when HydraDB adds its own deps.
2. **Please confirm canonical skill IDs.** `data/seed/skills.sample.json`
   currently has only `batch_pdf_extraction`. My R4 output for the PDF demo
   brief assumes `pdf_ocr`, `table_extraction`, `schema_mapping`,
   `csv_generation`, `data_validation` also exist with those exact ids in the
   HydraDB skill catalog — if the catalog uses different ids the join will
   silently miss.

## Files I will create

```txt
src/server/rocketride/client.ts        RocketRide SDK client + runPipeline
src/lib/rocketride/mapEvent.ts         RawMarketplaceEvent -> TrustEvent[]
src/lib/rocketride/extractSkills.ts    job brief -> skill_id[]
src/lib/rocketride/anonymize.ts        PII scrub for free text
src/lib/rocketride/validate.ts         JSON-Schema validation gate
rocketride/pipelines/classify.pipe     event classification pipeline
rocketride/pipelines/extract_skills.pipe  skill extraction pipeline
rocketride/samples/*.sample.json       one raw event per type
rocketride/samples/out/                validated pipeline output (fallback)
```
