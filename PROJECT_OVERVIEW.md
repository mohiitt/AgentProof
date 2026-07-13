# AgentProof Project Overview

## What AgentProof Is

AgentProof is a trust layer for marketplaces where AI agents hire other AI
agents. Instead of asking only "which agent has the highest rating?", it asks:

> Which agent is safest to hire for this exact job, required skills, buyer
> preferences, and risk level?

The project demonstrates that a lower-rated agent can be the better hire when
recent, skill-specific evidence is stronger than a generic star average.

The canonical demo is:

```txt
Extract structured data from 500 PDFs into a clean, validated CSV.
```

For this task, Agent A has a higher global rating, but AgentProof recommends
Agent B because Agent A has recent failures on large PDF extraction and
validation work, while Agent B has stronger recent evidence for the same skill
context.

## Problem It Solves

Traditional marketplace reputation is too flat. A single rating hides important
context:

- whether an agent is good at this exact skill;
- whether its failures are recent;
- whether it succeeds at the requested scale;
- whether the buyer cares more about risk, price, verification, or speed;
- whether a repeat hire or dispute should change the recommendation.

AgentProof turns raw marketplace outcomes into skill-level trust evidence, then
uses that evidence to produce auditable hire, warn, and avoid recommendations.

## System Flow

```txt
Marketplace event
  -> RocketRide pipeline
  -> trust event contract
  -> HydraDB ingestion and retrieval
  -> trust scoring
  -> recommendation contract
  -> AgentProof web app
```

The shared contract files are the integration boundary:

- `contracts/trust_event_schema.json`
- `contracts/trust_recommendation_schema.json`
- `contracts/skill_schema.json`

RocketRide and HydraDB are intentionally separated behind these contracts, so
each side can be developed and tested independently.

## Demo Experience

Start the app from the repository root:

```bash
./start.sh
```

Then open:

```txt
http://127.0.0.1:5173
```

The demo flow:

1. Enter or keep the default 500-PDF job brief.
2. Pick a buyer memory profile. This is the preference lens, not the agent
   being hired.
3. Read the compact judge path:
   RocketRide decomposes the job into skills, HydraDB retrieves skill-level
   evidence and buyer memory, and AgentProof recommends the safest agent.
4. Choose **Demo mode** for the deterministic seeded path or **Live mode** for
   server-side RocketRide and HydraDB proof. Live mode hides agent data until
   the proof checks finish.
5. Optionally click **Run live checks** in the Live tools panel to test the
   tools without changing modes.
6. Click **Analyze trust**.
6. Watch the Trust Analysis Journey:
   - RocketRide resolves the job into skills.
   - HydraDB retrieves matching evidence and buyer memory.
   - Trust scoring compares agents.
   - AgentProof reveals the recommendation.
7. Review resolved skills, claimed-versus-proven evidence, score audits, the
   optional full candidate roster, buyer-memory changes, and contract-shaped
   JSON.

The browser demo is offline-safe. It does not expose HydraDB or RocketRide
credentials to the frontend. It uses committed seed data plus the same tested
TypeScript skill extraction and trust-scoring logic.

## RocketRide Usage

RocketRide owns the event and skill-processing side of the system.

Its role is to convert messy marketplace activity into structured trust signals:

- job completion events;
- late delivery events;
- disputes;
- refunds;
- repeat hires;
- skill extraction from a buyer job brief;
- PII-safe event text before trust ingestion.

Important paths:

- `rocketride/`
- `rocketride/pipelines/`
- `src/server/rocketride/`
- `src/lib/rocketride/`
- `rocketride/samples/`

In the demo today:

- `src/lib/rocketride/extractSkills.ts` provides deterministic skill extraction
  for the browser demo.
- `src/lib/rocketride/mapEvent.ts` maps raw marketplace events into the shared
  trust event shape.
- The optional Live tools panel and Live mode connect to RocketRide through the
  server-side SDK when `ROCKETRIDE_URI` and `ROCKETRIDE_APIKEY` are configured.
  The check pings RocketRide, fetches the service catalog, validates the skill
  pipeline, and returns safe proof details.
- Detailed provider-specific caveats live in `rocketride/pipelines/README.md`.

RocketRide output must validate against:

```txt
contracts/trust_event_schema.json
```

Example output shape:

```txt
Raw marketplace event -> anonymized/classified trust event -> HydraDB ingest
```

## HydraDB Usage

HydraDB owns the trust memory, evidence retrieval, and recommendation grounding
side of the system.

Its role is to store and query:

- skills;
- agent profiles;
- claimed skills;
- verified skill-level trust events;
- buyer preference profiles;
- buyer-specific memory.

Important paths:

- `hydradb/`
- `src/server/hydradb/`
- `src/server/trust/`
- `src/lib/trust/`
- `src/types/hydradb.ts`
- `data/seed/`

In the demo today:

- `data/seed/skills.json` defines the skill catalog.
- `data/seed/agents.json` defines candidate agents.
- `data/seed/agent-skill-claims.json` separates claims from verified evidence.
- `data/seed/trust-events.json` contains the skill-level outcomes.
- `data/seed/buyer-preferences.json` changes ranking behavior by buyer.
- `src/lib/trust/scoring.ts` produces deterministic offline recommendations.

HydraDB live usage is server-side only and requires explicit environment
configuration:

```bash
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs
```

The smoke check creates or verifies the configured database, ingests seed
knowledge and buyer memory, polls indexing readiness, and verifies retrieval
queries. It does not print credentials.

## Recommendation Logic

AgentProof does not rank by global rating alone. The trust score combines:

- global rating;
- matched skills;
- recent skill-specific evidence;
- repeat hires;
- verification and SLA fit;
- buyer price preference;
- incident penalties such as failures, disputes, refunds, and late delivery.

This is why the demo can show:

```txt
Agent B, rating 4.6, beats Agent A, rating 4.9
```

Agent B wins because the recent evidence is better for the requested PDF
extraction and validation work.

Buyer preferences also change the result. A risk-averse buyer penalizes recent
incidents heavily. A price-sensitive buyer may allow a lower-cost agent to move
from avoid to recommended when the evidence is adequate.

## Data and Contracts

The important seed datasets are:

- `data/seed/skills.json`
- `data/seed/agents.json`
- `data/seed/agent-skill-claims.json`
- `data/seed/trust-events.json`
- `data/seed/buyer-preferences.json`

The important shared contracts are:

- `contracts/trust_event_schema.json`
- `contracts/trust_recommendation_schema.json`
- `contracts/skill_schema.json`

The UI exposes the final recommendation JSON so the demo can be audited against
the contract instead of being only a visual mock.

## Offline Demo Versus Live Tools

The web app intentionally uses an offline-safe default flow:

```txt
Browser UI
  -> deterministic skill extractor
  -> seed evidence
  -> deterministic trust scoring
  -> recommendation JSON
```

Live checks are separate and server-side:

```txt
HydraDB live smoke
RocketRide pipeline/client checks
```

This separation keeps credentials out of the browser while still proving the
integration boundaries.

The UI also includes optional local `/api/*` proof checks:

```txt
/api/hydradb/live-retrieve
/api/rocketride/live-check
```

If HydraDB is not configured, the UI reports that the committed seed mirror is
active. If RocketRide is unavailable, the UI reports that deterministic local
skill extraction is active. Neither condition breaks the main demo.

## How To Verify

Run the main checks:

```bash
npm test
npm run typecheck
npm run build
```

Run the app:

```bash
./start.sh
```

Optional HydraDB live verification:

```bash
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs
```

Optional RocketRide proof:

```bash
ROCKETRIDE_URI=wss://api.rocketride.ai/task/service ROCKETRIDE_APIKEY=<secret> ./start.sh
```

## Current Implementation Status

Implemented:

- interactive frontend demo;
- staged Trust Analysis Journey;
- RocketRide-style skill extraction fallback;
- HydraDB seed mirror for skills, agents, claims, trust events, and buyer memory;
- deterministic trust scoring;
- buyer-specific recommendations;
- contract-shaped recommendation JSON;
- optional Live mode and Live tools panel with server-side fallback-safe checks;
- sequential Live mode reveal after proof checks, so the decision path and each
  downstream explanation section appears as a separate demo beat;
- offline tests, typecheck, and production build.

Known live-service caveat:

- HydraDB live smoke is server-side and credential-gated.
- RocketRide proof is server-side. `localhost:5565` is only a local engine
  reachability target; the current proof path uses the configured RocketRide SDK
  URI from `.env` to ping the service, fetch the catalog, and validate the
  pipeline.

## One-Sentence Summary

AgentProof shows how RocketRide can turn marketplace activity into structured
trust events, while HydraDB stores and retrieves skill-level memory so the app
can recommend the safest agent for a specific buyer and job.
