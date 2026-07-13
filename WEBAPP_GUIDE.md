# AgentProof Web App Guide

## Start the app

From the repository root:

```bash
./start.sh
```

The launcher installs locked dependencies when needed, runs the unit tests and
TypeScript check, and starts the app at `http://127.0.0.1:5173`.

If port 5173 is already in use:

```bash
PORT=5174 ./start.sh
```

For a faster restart after the checks have already passed:

```bash
RUN_CHECKS=0 ./start.sh
```

Stop the app with `Ctrl+C` in the terminal that is running it.

## Use the interactive demo

1. Open `http://127.0.0.1:5173` in a browser.
2. Scroll to **Run the demo**, or select **Analyze** in the top navigation.
3. Keep the default 500-PDF task, write a supported task, or use one of the
   example buttons. The deterministic RocketRide fallback recognizes the
   catalog terms PDF, structured/table data, schema, CSV, validation,
   citations, and web research.
4. Choose a buyer memory profile. This is not the agent being hired; it tells
   AgentProof how to weight risk aversion, price sensitivity, verification
   requirements, and SLA priority.
5. Choose **Demo mode** for the deterministic seeded path or **Live mode** for
   server-side tool proof. Live mode hides agent data until RocketRide and
   HydraDB finish their checks.
6. Select **Analyze trust**.
6. Read the compact judge path: RocketRide decomposes the job into skills,
   HydraDB retrieves skill-level evidence and buyer memory, and AgentProof
   recommends the safest agent.
7. Use **Live tools** when you want to run the proof checks without changing
   modes.
8. Watch **Trust analysis journey** progress through the four stages:
   RocketRide skill extraction, HydraDB evidence retrieval, trust scoring, and
   the final AgentProof recommendation.
9. Inspect **Resolved skills** to see how RocketRide decomposed the job brief
   into the local skill catalog.
10. Review **Claimed skills vs proven skills** to see why claims are separated
    from verified delivery outcomes.
11. Review the HydraDB evidence panel. It shows matching trust events, claimed
   skills, buyer memory, and the incidents that affect the decision without
   exposing live credentials to the browser.
12. Inspect **Trust score audit** to see the score math for the recommended
    agent and a rejected comparison.
13. Expand **View full candidate roster** if you want every candidate card.
   Each card shows the hire classification, global rating, price tier, matched
   skills, score explanation, and evidence count.
14. Read **Explain decision** and **Why this result** to see why Agent B beats
    higher-rated Agent A for the canonical PDF job.
15. In **Buyer memory comparison**, select another buyer memory profile. The
    same task is immediately recalculated with that profile's preferences.
16. Expand **View contract-shaped recommendation JSON** to inspect the exact
    object shaped for `contracts/trust_recommendation_schema.json`.
For the canonical PDF task, the important result is Agent B beating the
higher-rated Agent A because Agent A has recent high-volume extraction and
validation failures. A price-sensitive buyer changes Agent C from avoid to
recommended, demonstrating that buyer memory alters the decision even when
Agent B remains the top-ranked candidate.

## Offline demo versus live tools

The browser demo is local-first and fallback-safe. It intentionally does not
receive HydraDB or RocketRide credentials. The default path uses committed seed
data and the same pure TypeScript skill and trust logic, so it is safe and
reliable for a local demo.

The **Live tools** panel and **Live mode** toggle call local Vite middleware
routes that run server-side checks and return safe summaries:

```txt
/api/hydradb/live-retrieve
/api/rocketride/live-check
```

If HydraDB is not configured, the UI shows:

```txt
HydraDB offline fallback active — using committed seed mirror.
```

If RocketRide SDK credentials are configured, the RocketRide check connects to
the configured server, pings it, fetches the service catalog, validates the
skill extraction pipeline, and returns a safe summary. Use the Live tools card
disclosure labeled **View proof details** to show the SDK URI, service count,
pipeline validation result, resolved skills, and schema compatibility without
showing secrets. If the configured RocketRide server is unavailable, the UI
shows:

```txt
RocketRide offline fallback active — using deterministic local skill extraction.
```

The main **Analyze trust** button should still work in both cases.

Verify the live HydraDB database from the server side with:

```bash
HYDRA_DB_ENABLED=true node --env-file=.env --experimental-strip-types hydradb/live-smoke.mjs
```

`http://localhost:5565` is not required for the current proof path. That port is
only a local RocketRide engine reachability target if you separately run such an
engine. In this project, the stronger proof is the server-side RocketRide SDK
check using `ROCKETRIDE_URI` and `ROCKETRIDE_APIKEY` from `.env`. If
`localhost:5565` is unreachable but the SDK check says **Connected**, you can
still truthfully say AgentProof used RocketRide server-side for ping, service
catalog, and pipeline validation.

Detailed provider-specific caveats, including the current Cloud anonymization
behavior, live in `rocketride/pipelines/README.md`.

## Troubleshooting

- **Permission denied for `./start.sh`:** run `chmod +x start.sh` once.
- **Port already in use:** run `PORT=5174 ./start.sh` and open that port.
- **No skills matched:** use one of the example buttons or mention a skill term
  supported by the catalog.
- **Live check reports missing credentials:** confirm `.env` contains
  `HYDRA_DB_ENABLED=true`, `HYDRA_DB_API_KEY`, and `HYDRA_DB_DATABASE_ID`.
  Do not put secret values in `VITE_` variables.
- **RocketRide local check shows fallback:** start the local engine or set
  `ROCKETRIDE_LOCAL_URI`; the deterministic fallback proof remains valid.
- **Browser page is stale after a code change:** refresh the page; Vite normally
  hot-reloads automatically.
