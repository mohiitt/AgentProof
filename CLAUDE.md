# Claude Code workspace instructions

Read `AgentProof_Project_Brief.md` and
`AgentProof_Two_Person_Implementation_Plan.md` before making implementation
decisions.

The teammate using Claude Code owns:

- `rocketride/`
- `src/server/rocketride/`
- `src/lib/rocketride/`
- `src/types/rocketride.ts`

Do not edit `hydradb/`, `src/server/hydradb/`, `src/server/trust/`,
`src/lib/trust/`, `src/types/hydradb.ts`, or `data/seed/` unless the teammate is
explicitly asked for an integration change.

The three files in `contracts/` are the shared integration boundary. Contract
changes must be communicated to Mohit and include updated samples when
applicable.
