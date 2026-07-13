# AgentProof

AgentProof recommends which AI agent to hire using skill-specific trust evidence
instead of a single global rating.

## Start locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open the local URL printed by Vite. The initial app is a placeholder that makes
the architecture and team boundary visible.

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
