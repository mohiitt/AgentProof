# HydraDB workstream

This directory holds HydraDB-facing artifacts for AgentProof. The raw REST
adapter is `src/server/hydradb/client.ts`; deterministic, offline trust scoring
is `src/lib/trust/scoring.ts`.

## Safe local use

No default code path makes a network call. Live calls require all three:

- `HYDRA_DB_ENABLED=true`
- `HYDRA_DB_API_KEY`
- `HYDRA_DB_DATABASE_ID`

Tests inject a mock `fetch`, so the default test/typecheck/build flow needs no
credential. `HYDRA_DB_DATABASE_ID` is the product-facing database name.
Service-layer `tenantId`/`subTenantId` parameters are translated only at the
adapter boundary to HydraDB v2 `database`/`collection` fields.

## HydraDB API v2 contract

The dependency-free adapter follows the supplied current integration guide:

- Every raw call sends `Authorization: Bearer ...` and `API-Version: 2`, reads
  successful payloads from `{ success, data, error, meta }.data`, and includes
  `meta.request_id` in surfaced failures.
- `POST /databases` creates the database with its planned
  `tenant_metadata_schema`; `GET /databases/status?database=...` is polled until
  `infra.ready_for_ingestion` is true.
- `POST /context/ingest` is multipart. Knowledge uses `type=knowledge`, a
  consistent `database` and `collection`, `upsert=true`, and JSON-stringified
  `app_knowledge`. Each record uses stable `id`, `content.text`, filterable
  `tenant_metadata`, free-form `additional_metadata`, and optional
  `relations.ids`.
- Buyer preferences use the same endpoint with `type=memory`, a buyer-specific
  `collection`, a stable ID, and JSON-stringified `memories`. Raw preference
  text uses `infer: true`; each memory object's `tenant_metadata` is itself a
  JSON string inside the JSON-stringified `memories` array, per the v2 guide.
- `GET /context/status` receives repeated `ids`. `graph_creation` and
  `completed` are searchable success states; `errored` and `failed` are
  terminal failures.
- `POST /query` is the only retrieval endpoint. Knowledge, memory, and combined
  personalized lookup use `type: knowledge`, `memory`, and `all`; app-aware
  lookup uses `query_apps`.
- Browsing and deletion use `POST /context/list` and `DELETE /context`.
- Only HTTP 429, 500, and 503 retry, with bounded exponential backoff and
  jitter. Validation/auth/not-found/conflict responses do not retry.

The schema in `seed/tenant-metadata-schema.json` declares the hot exact-match
fields before ingestion. Canonical raw data under `data/seed/` separates agent
skill claims from verified trust evidence.

Primary reference: the supplied HydraDB Agent Integration Guide, based on the
[HydraDB v2 docs](https://docs.hydradb.com/get-started/v2) and
[v2 OpenAPI](https://docs.hydradb.com/api-reference/v2/openapi.json).

## Live smoke check

After placing the two credentials in repository `.env`, opt in explicitly:

```sh
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs
```

The flow creates the configured database only when absent, waits for readiness,
upserts reference and trust-event knowledge into `default`, upserts preferences
into buyer memory collections, polls indexing, then verifies skill, claim,
skill-failure, memory, and combined `type=all` queries. It
prints statuses/counts only and never prints credentials.

Reference skills, agent profiles, skill claims, and trust events are shared
knowledge in `collection=default`. Buyer preferences are memories in
`collection=buyer_id`. Live verification showed that a buyer-scoped `type=all`
query returned buyer memory but did not surface knowledge stored in `default`.
The Hydra-backed recommendation path therefore uses two explicit lanes: a
`type=knowledge` query against `default` for shared skill, agent, and trust
evidence, followed by a buyer-scoped `type=all` query for personalized memory.
Server order is retained within each lane, source IDs are deduplicated, and
only shared-lane IDs matching validated local trust events become contract
evidence. Either retrieval failure is surfaced to the caller. The synchronous
deterministic `recommend()` remains available for offline behavior.

The following modes exist only to remediate the previously audited accidental
default-collection upload. Cleanup refuses to run unless the default collection
contains exactly 16 records and all 16 are marked `source=agentproof_seed`:

```sh
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs --audit-default
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs --cleanup-default
```

The earlier smoke version wrote trust events into buyer collections. Its
dedicated migration mode lists each known buyer collection, requires an exact
match of all 16 stable seed event IDs with `source=agentproof_seed`, deletes
knowledge only (never memories), and polls for those IDs to become absent. It
is resumable: a buyer collection with no matching seed knowledge is skipped,
while any nonempty partial or mismatched seed set is rejected.

```sh
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs --cleanup-buyer-trust
```
