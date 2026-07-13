# AgentProof

AgentProof recommends which AI agent to hire using skill-specific trust evidence
instead of a single global rating.

## Start locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```bash
./start.sh
```

Open `http://127.0.0.1:5173`. The launcher installs locked dependencies when
needed, runs the test/typecheck preflight, and starts the interactive demo.
Use `RUN_CHECKS=0 ./start.sh` for a faster restart or `PORT=5174 ./start.sh`
when the default port is busy.

The browser demo is local-first and fallback-safe. Optional **Live tools**
checks run server-side through local `/api/*` routes and never expose HydraDB or
RocketRide credentials to the frontend.

See `WEBAPP_GUIDE.md` for the detailed interaction flow, demo/live-service
boundary, and troubleshooting steps.

Useful checks:

```bash
npm run typecheck
npm run build
```

## Work independently

Start both feature branches from the boilerplate commit.

- Mohit/Codex: use `codex/hydradb-trust-layer`; follow `AGENTS.md`; own
  `hydradb/`, `src/server/hydradb/`, `src/server/trust/`, and `src/lib/trust/`.
- Teammate/Claude Code: use `feature/rocketride-pipelines`; follow `CLAUDE.md`;
  own `rocketride/`, `src/server/rocketride/`, and `src/lib/rocketride/`.

The files in `contracts/` are shared. Coordinate before changing them. Each side
can develop against `rocketride/samples/trust-event.sample.json` without waiting
for the other service.

Read `AgentProof_Project_Brief.md` for canonical product context and
`AgentProof_Two_Person_Implementation_Plan.md` for the full phased plan.

## Repository map

```txt
contracts/        Shared JSON Schema integration boundary
data/seed/        HydraDB-side demo data
hydradb/          HydraDB setup, seed, and query artifacts
rocketride/       RocketRide pipelines and sample I/O
src/app/          Shared placeholder UI shell
src/server/       Server modules split by owner
src/lib/          Client/domain modules split by owner
src/types/        Shared and vendor-specific TypeScript types
```
