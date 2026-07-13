# Codex workspace instructions

Read `AgentProof_Project_Brief.md` and
`AgentProof_Two_Person_Implementation_Plan.md` before making implementation
decisions.

Mohit/Codex owns:

- `hydradb/`
- `src/server/hydradb/`
- `src/server/trust/`
- `src/lib/trust/`
- `src/types/hydradb.ts`
- `data/seed/`

Do not edit `rocketride/`, `src/server/rocketride/`,
`src/lib/rocketride/`, or `src/types/rocketride.ts` unless Mohit explicitly
asks for an integration change.

The three files in `contracts/` are the shared integration boundary. Contract
changes must be communicated to the RocketRide owner and include updated
samples when applicable.
