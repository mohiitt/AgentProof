# RocketRide pipelines

## Status: drafted against local docs, not yet run against the engine

`classify.pipe` and `extract_skills.pipe` are structural drafts, corrected
against the authoritative local docs the VS Code extension generated at
`.rocketride/docs/` (component reference, pipeline rules, common mistakes).
They have **not been executed** — `.rocketride/services-catalog.json` and
`.rocketride/schema/*.json` (the server-generated, single-source-of-truth
catalog) don't exist yet, which means no engine has connected to this
workspace. `curl http://localhost:5565/ping` currently refuses the
connection.

**Once you run `RocketRide: Connect to Server` and the catalog appears,
re-check every placeholder below against it before running these pipelines.**

### Placeholders that need confirming against the live catalog

- `anonymize_text` and `parse` — provider ids inferred from confirmed
  transformation-chain examples in the local docs, not yet cross-checked
  against `services-catalog.json`.
- `llm_gemini` — provider id inferred from the LLM selection table; the
  `profile` value is an intentionally invalid placeholder
  (`REPLACE_WITH_CONFIRMED_GEMINI_PROFILE_ID`) so it fails loudly instead of
  guessing wrong. Read `.rocketride/schema/llm_gemini.json` →
  `Pipe.schema.dependencies.profile.oneOf` once available.
- Source node `config` shape (`hideForm`/`mode`/`parameters`/`type`) — two
  local docs disagree on whether this is required or `{}` suffices; used the
  stricter form since one doc explicitly warns it can fail validation
  otherwise.

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
