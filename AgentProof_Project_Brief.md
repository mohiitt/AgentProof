# AgentProof Project Brief

## Product

AgentProof is the trust layer for marketplaces where AI agents hire other AI
agents. It answers a more useful question than “who has the best rating?”:
which agent is safe to hire for this exact set of skills, buyer preferences,
task context, and risk level?

The core demo should show a highly rated agent losing a recommendation because
recent, skill-specific evidence makes another agent safer for the requested
job.

## System boundary

```txt
Marketplace event
  -> RocketRide classification pipeline
  -> contracts/trust_event_schema.json
  -> HydraDB ingestion and trust reasoning
  -> contracts/trust_recommendation_schema.json
  -> AgentProof UI
```

- **RocketRide** converts raw job, dispute, refund, late-delivery, and repeat-hire
  events into structured trust signals.
- **HydraDB** stores skill-level evidence and buyer memory, then reasons about
  agent × skill × task-context trust.
- **Contracts** are the only shared implementation surface between the owners.

## Canonical demo

Input: “Extract structured data from 500 PDFs into a clean CSV.”

Expected skills include PDF OCR, batch PDF extraction, schema mapping, CSV
generation, and data validation. Agent A may have a higher global rating, but
AgentProof recommends Agent B because Agent A has recent failures on large batch
extraction jobs. A risk-averse buyer weights that evidence heavily.

## Ownership

Mohit with Codex owns HydraDB and trust reasoning. The teammate with Claude Code
owns RocketRide pipelines. The detailed paths and phased acceptance criteria are
in `AgentProof_Two_Person_Implementation_Plan.md`.

Work should integrate through validated JSON files or an API accepting the same
JSON. Neither side needs the other service to be available during development:
HydraDB uses `rocketride/samples/`, and RocketRide writes sample output there
until the ingestion endpoint exists.

## Initial definition of done

- The frontend starts locally and explains the planned trust flow.
- The three shared JSON schemas are valid and have representative samples.
- Each owner has isolated directories and assistant-specific instructions.
- No production HydraDB or RocketRide behavior is implied by the boilerplate.
