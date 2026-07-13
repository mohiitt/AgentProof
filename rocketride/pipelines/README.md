# RocketRide pipelines

## Status: classify.pipe confirmed running; extract_skills.pipe fixed, needs a real key

The local engine is connected (`.rocketride/services-catalog.json` and
`schema/*.json` now exist). Every provider id guessed from the docs turned
out correct against the real catalog: `webhook`, `chat`, `parse`,
`anonymize_text`, `prompt`, `llm_gemini`, `response_text`, `response_answers`
all exist. Two things were fixed against the live schema:

- **`classify.pipe`**: `anonymize_text_1` had an empty `config` (its
  `profile` field is required). Set to `glinerMultiPII` — a local NER model
  bundled with the engine, no API key needed — with `anonymizeChar: "█"`.
  `classify.pipe` is confirmed running end-to-end.
- **`extract_skills.pipe`**: failed with "Pipeline references 1 undefined
  variable" — `${ROCKETRIDE_GEMINI_KEY}` isn't set in `.env`. Also fixed the
  node config shape, which was wrong: per
  `.rocketride/schema/llm_gemini.json`, the nested config key is a short
  label (`"5-flash"`), **not** the profile string itself
  (`"gemini-2_5-flash"`) — different from the `llm_anthropic` pattern this
  was originally modeled on. Still needs a real `ROCKETRIDE_GEMINI_KEY` in
  `.env` to actually run; until then use `extractSkills()`
  (`src/lib/rocketride/extractSkills.ts`), the deterministic fallback.

Source-node `config` requires `hideForm`/`mode`/`type` (confirmed via
`.rocketride/schema/webhook.json` and `chat.json` — `required` includes all
three); `parameters` is optional. Response nodes' schemas list `laneName` as
required, but the local common-mistakes doc explicitly endorses `config: {}`
as correct/default for them, and `response_text`/`response_answers` run fine
with `{}` in the confirmed-working `classify.pipe` — left as `{}`.

## Why classify.pipe only does PII scrubbing, not classification

The `event_type` -> `edge_type`/`outcome` mapping is deterministic (we author
these raw events ourselves) and lives in one place,
`src/lib/rocketride/mapEvent.ts`, unit-tested against
`contracts/trust_event_schema.json`. There is no plain HTTP node in
RocketRide's component model — `tool_http_request` is a tool, invocable only
by an agent via the `control` plane — so `classify.pipe` does not attempt to
call back into our own service from inside the graph. Instead it runs
`webhook -> parse -> anonymize_text -> response_text`, and
`src/server/rocketride/client.ts` runs `mapEvent()` in TypeScript on the
returned (already-anonymized) event text. This also means the real engine's
PII detection can be strictly better than the offline regex fallback
(`src/lib/rocketride/anonymize.ts`) without any pipeline-JSON changes.

## extract_skills.pipe has a required fallback

If `ROCKETRIDE_GEMINI_KEY` is unset, callers should use `extractSkills()`
(`src/lib/rocketride/extractSkills.ts`) directly instead of running this
pipeline — it is a deterministic keyword matcher over the same `skill_id`
taxonomy and needs no credentials. It is what the offline demo runs today.
Uses `chat` (not `webhook`) as the source since a job brief is a
conversational/single-shot question — see `client.chat()` vs `client.send()`
in `ROCKETRIDE_COMMON_MISTAKES.md`.

Every produced trust event must validate against
`../contracts/trust_event_schema.json`; see
`src/lib/rocketride/validate.ts` for the enforcement point. Sample inputs
live in `../samples/events/`, one per marketplace event type.
