# RocketRide pipelines

## Status: extract_skills.pipe mechanically verified (blocked on Gemini billing); classify.pipe blocked on a RocketRide-side anonymize_text outage

Connected to RocketRide Cloud (`ROCKETRIDE_URI=https://api.rocketride.ai` in
`.env`; the local engine was never actually used -- see PLAN.md). Every
provider id guessed from the docs turned out correct against the real
catalog: `webhook`, `chat`, `parse`, `anonymize_text`, `prompt`, `llm_gemini`,
`response_text`, `response_answers` all exist, and two real config bugs were
found and fixed (missing `anonymize_text` profile; wrong `llm_gemini` nested
key -- see git history on this file for detail).

**`anonymize_text` itself is broken on this Cloud account**, isolated
through six live test runs with `client.use()`/`client.send()` directly
(bypassing this repo's `.pipe` files to control every variable):

| Pipeline | Result |
| --- | --- |
| `webhook -> response_text` (no processing) | works, instant |
| `webhook -> parse -> response_text` | works, instant |
| `webhook -> anonymize_text -> response_text` (`glinerMultiPII`) | `use()` hangs, 30s+ |
| same, fresh `project_id` each time | still hangs (rules out zombie/orphaned task state) |
| same, `glinerSmall` profile instead | still hangs (rules out that specific model) |

`webhook` and `parse` are confirmed fine in isolation; `anonymize_text` hangs
`client.use()` itself (before any data is even sent) regardless of profile,
`project_id` freshness, or `useExisting`. This looks like a genuine outage or
broken deployment of that node type on the connected Cloud account, not a
config mistake on our side. Not something diagnosable further without
RocketRide's own dashboard/logs.

**Consequence:** `classify.pipe` and `client.ts`'s `classifyEvent()` are
**currently non-functional** end-to-end because of this. The fully offline,
fully-tested path (`mapEvent()` + `anonymizeText()` regex fallback,
`src/lib/rocketride/`) remains the reliable one for the demo and needs no
change. Re-test `classify.pipe` once RocketRide's `anonymize_text` node is
confirmed healthy again (their status page, or a support ticket).

`extract_skills.pipe`: **mechanically confirmed working end-to-end**
(`use()` and `client.chat()` both fast and correct) once
`ROCKETRIDE_GEMINI_KEY` was set. Went through three `llm_gemini` profiles
while live-testing:

| Profile | Result |
| --- | --- |
| `gemini-2_5-flash` (first guess, nested key `"5-flash"`) | fast LLM error: model deprecated, "no longer available to new users" |
| `models-gemini-flash-latest` | `chat()` hangs, 45s+ -- possibly the same quota issue below manifesting as retries instead of a fast error; not conclusively isolated |
| `gemini-2_0-flash` (committed) | fast, correct pipeline mechanics; LLM call itself fails with `429 RESOURCE_EXHAUSTED`, `limit: 0` on the free tier |

The `limit: 0` quota response means the `ROCKETRIDE_GEMINI_KEY` project has
no Gemini free-tier allocation at all -- an account/billing issue on
[Google AI Studio](https://ai.google.dev/gemini-api/docs/rate-limits) /
Cloud Console for that key, not a RocketRide or pipeline-config problem.
Enable billing (or use a key that has it) to actually get skill-extraction
answers back; until then `extractSkills()`
(`src/lib/rocketride/extractSkills.ts`) is what the demo runs, and needs no
change -- the keyword fallback was never blocked by any of this.

Source-node `config` requires `hideForm`/`mode`/`type` (confirmed via
`.rocketride/schema/webhook.json` and `chat.json` — `required` includes all
three); `parameters` is optional. Response nodes' schemas list `laneName` as
required, but the local common-mistakes doc explicitly endorses `config: {}`
as correct/default for them, and `response_text`/`response_answers` ran fine
with `{}` in every live test above — left as `{}`.

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
