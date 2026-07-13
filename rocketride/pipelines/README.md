# RocketRide pipelines

## Status: drafted, not yet run against the engine

`classify.pipe` and `extract_skills.pipe` are structural drafts built from
`docs.rocketride.org` (components, lanes, `${VAR}` interpolation, the
`llm_anthropic` node shape). They have **not been executed** — there is no
local RocketRide engine running yet (R1). Before running either pipeline:

- Confirm the exact provider ids used as placeholders:
  `anonymize`, `http_request`, `llm_gemini` (only `webhook`, `response`, and
  `llm_anthropic` are confirmed from the docs). Check the live node catalog
  once the engine/VS Code extension is available.
- Replace `REPLACE_WITH_CONFIRMED_GEMINI_PROFILE_ID` in `extract_skills.pipe`
  with a real Gemini profile id — left as an intentionally invalid
  placeholder so it fails loudly instead of silently guessing wrong.
- Wire `ROCKETRIDE_CLASSIFY_ENDPOINT` once `src/server/rocketride/client.ts`
  (R1) exposes it.

## Why classify.pipe calls out to our own endpoint

The `event_type` -> `edge_type`/`outcome` mapping is deterministic (we author
these raw events ourselves) and lives in one place,
`src/lib/rocketride/mapEvent.ts`, which is unit-tested against
`contracts/trust_event_schema.json`. `classify.pipe` does I/O and PII
scrubbing (Anonymize) and delegates classification to that same tested logic
via HTTP rather than re-encoding the edge-type table a second time as
pipeline JSON, which would drift.

## extract_skills.pipe has a required fallback

If `GEMINI_API_KEY` is unset, callers should use
`extractSkills()` (`src/lib/rocketride/extractSkills.ts`) directly instead of
running this pipeline — it is a deterministic keyword matcher over the same
`skill_id` taxonomy and needs no credentials. It is what the offline demo
runs today.

Every produced trust event must validate against
`../contracts/trust_event_schema.json`; see
`src/lib/rocketride/validate.ts` for the enforcement point. Sample inputs
live in `../samples/events/`, one per marketplace event type.
