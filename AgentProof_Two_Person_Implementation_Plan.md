# AgentProof — Two-Person Implementation Plan

## Purpose

This plan divides the AgentProof build between two people so both can work independently without stepping on each other's files.

AgentProof is the trust layer for AI agents that hire other AI agents. It decomposes a job into required skills, checks which agents have proven trust for those skills, and recommends whether to hire, warn, or avoid a candidate agent.

Core split:

```txt
HydraDB = trust memory + skill/agent reputation reasoning
RocketRide = pipeline runtime that converts job events into structured trust signals
```

---

## Important project-context file

Keep this file in the project root:

```txt
AgentProof_Project_Brief.md
```

This file should be treated as the canonical product/context brief for Codex and Claude Code.

When using Codex, ask it to read this file first before making implementation decisions. Since Codex will also receive the GPT relay skill, mention that the relay should use `AgentProof_Project_Brief.md` as the canonical product context.

Suggested Codex instruction:

```txt
Read AgentProof_Project_Brief.md first. Treat it as the canonical product brief. Use the GPT relay skill for implementation planning and code changes. Do not change files outside your assigned ownership unless explicitly asked.
```

For the teammate using Claude Code, share the same file as context, but also give this implementation plan so Claude knows which files it owns.

---

## Step 0 — One person creates the boilerplate first

Before both people start, one person should create the shared app boilerplate.

Recommended owner: **Mohit / Codex**

Why: the HydraDB side needs the backend contracts, schemas, and shared route structure, so it is easier if the Codex/HydraDB owner creates the base structure first.

### Boilerplate responsibilities

Create only the skeleton, not full implementation:

```txt
agentproof/
  AgentProof_Project_Brief.md
  AgentProof_Two_Person_Implementation_Plan.md
  README.md
  .env.example
  package.json
  src/
    app/
    components/
    lib/
    server/
    types/
  contracts/
    trust_event_schema.json
    trust_recommendation_schema.json
    skill_schema.json
  data/
    seed/
  rocketride/
    README.md
    pipelines/
    samples/
  hydradb/
    README.md
    seed/
    queries/
```

### Boilerplate acceptance criteria

The boilerplate is done when:

```txt
- App starts locally with placeholder UI
- README explains how to run the project
- .env.example lists needed keys
- contracts/ folder exists
- hydradb/ and rocketride/ folders exist
- No real HydraDB or RocketRide logic is required yet
```

After this, both people can start working independently.

---

# Ownership split

## Person 1 — Mohit / Codex / HydraDB owner

Mohit owns the trust brain.

### Main responsibility

Build the HydraDB-backed trust and reputation layer.

### Owns these folders

```txt
hydradb/
src/server/hydradb/
src/server/trust/
src/lib/trust/
src/types/hydradb.ts
contracts/
data/seed/
```

### Should avoid editing

```txt
rocketride/
src/server/rocketride/
src/lib/rocketride/
```

Unless a shared contract update is needed.

---

## Person 2 — Teammate / Claude Code / RocketRide owner

Teammate owns the event pipeline runtime.

### Main responsibility

Build the RocketRide pipelines that process job events into structured trust events.

### Owns these folders

```txt
rocketride/
src/server/rocketride/
src/lib/rocketride/
src/types/rocketride.ts
```

### Should avoid editing

```txt
hydradb/
src/server/hydradb/
src/server/trust/
src/lib/trust/
data/seed/
```

Unless a shared contract update is needed.

---

# Shared contracts

Both people must agree on these contracts before building deeper logic.

## 1. Trust event schema

File:

```txt
contracts/trust_event_schema.json
```

Purpose:

RocketRide produces this. HydraDB consumes this.

Logical shape:

```txt
trust_event_id
job_id
buyer_id
agent_id
skill_id
skill_name
task_category
outcome
edge_type
rating
price_tier
complexity
sla_level
dispute_status
arbitration_outcome
summary
reason
timestamp
source
additional_context
```

Example edge types:

```txt
CONFIRMED_BY
DISPUTED_BY
DELIVERED_LATE
PARTIAL_REFUND
RESOLVED_IN_FAVOR_OF_BUYER
RESOLVED_IN_FAVOR_OF_WORKER
REPEAT_HIRE
FAILED_SKILL
PASSED_SKILL
```

This is the most important contract in the whole project.

---

## 2. Skill schema

File:

```txt
contracts/skill_schema.json
```

Purpose:

Represents a skill as a first-class object.

Logical shape:

```txt
skill_id
name
description
category
input_type
output_type
risk_level
difficulty
dependencies
typical_failure_modes
evaluation_criteria
source
```

Example skills:

```txt
pdf_ocr
batch_pdf_extraction
table_extraction
schema_mapping
csv_generation
data_validation
citation_checking
web_research
vc_memo_writing
code_review
sales_email_drafting
```

---

## 3. Trust recommendation schema

File:

```txt
contracts/trust_recommendation_schema.json
```

Purpose:

HydraDB/trust layer produces this. Frontend displays this.

Logical shape:

```txt
request_id
buyer_id
task_summary
required_skills
recommended_agents
warn_agents
avoid_agents
best_agent_or_team
reasoning_summary
evidence
risk_level
confidence
```

Example output:

```txt
Recommend Agent B for batch PDF extraction.
Avoid Agent A for this job because it has recent disputes on high-volume PDF tasks.
Agent C is acceptable only if the buyer prioritizes low price over accuracy.
```

---

# End-to-end flow

```txt
1. Buyer posts task
   Example: "Extract structured data from 500 PDFs into a clean CSV."

2. System decomposes task into skills
   pdf_ocr
   batch_pdf_extraction
   schema_mapping
   csv_generation
   data_validation

3. HydraDB checks skill-level trust evidence
   similar jobs
   past disputes
   repeat hires
   failed skills
   buyer memories
   recent outcomes

4. System recommends agent or agent team
   hire / warn / avoid

5. RocketRide processes job outcome events
   job completed
   dispute filed
   refund issued
   repeat hire detected

6. RocketRide produces trust_event_schema.json object

7. HydraDB ingests trust event as reputation evidence

8. Future trust recommendations improve
```

---

# HydraDB implementation plan — Mohit / Codex

## Goal

Build the trust memory and reputation reasoning layer.

## Phase H1 — HydraDB setup

Tasks:

```txt
- Create HydraDB client setup
- Read HYDRA_DB_API_KEY from env
- Create or connect to AgentProof database
- Define planned tenant_metadata fields for hot filters
- Add status polling after database creation
```

Important metadata fields:

```txt
skill_id
agent_id
buyer_id
task_category
outcome
edge_type
price_tier
risk_level
complexity
sla_level
dispute_status
arbitration_outcome
```

Acceptance:

```txt
- Can connect to HydraDB
- Can confirm database is ready
- Can ingest one test knowledge item
- Can query it back
```

---

## Phase H2 — Seed skills and agents

Tasks:

```txt
- Create seed skills dataset
- Create seed agent profiles
- Create claimed agent-skill mappings
- Ingest skills as HydraDB knowledge
- Ingest agent profiles as HydraDB knowledge
```

Logic:

```txt
Skills = what capabilities exist
Agents = who claims to perform those skills
Claimed skills != trusted skills
```

Acceptance:

```txt
- Query can retrieve relevant skills for a task
- Query can retrieve agents claiming those skills
```

---

## Phase H3 — Seed trust history

Tasks:

```txt
- Create synthetic job history
- Break every job into skill-level execution records
- Create disputes, refunds, repeat hires, and failed-skill records
- Ingest job records as HydraDB knowledge
- Use relations.ids to connect jobs, skills, agents, and outcomes where useful
```

Logic:

```txt
One job can create multiple skill execution records.
Trust is not global. Trust is agent × skill × task context.
```

Acceptance:

```txt
- Query can find similar past jobs
- Query can find skill-specific failures
- Query can find recent dispute clusters
```

---

## Phase H4 — Buyer memories

Tasks:

```txt
- Create 3 to 5 demo buyers
- Store buyer preferences as HydraDB memories
- Use collection = buyer_id
- Use infer=true for raw preference text
```

Example buyer memories:

```txt
Buyer A is risk-averse and avoids agents with recent disputes.
Buyer B is price-sensitive and accepts minor delays for cheaper agents.
Buyer C only wants verified agents for high-SLA tasks.
```

Acceptance:

```txt
- Same task and same candidate agent can produce different recommendation for different buyers
```

---

## Phase H5 — Trust query logic

Tasks:

```txt
- Build trust recommendation function
- Input: buyer_id, task, candidate agents or all agents
- Decompose task into required skills or accept skills from RocketRide/frontend
- Query HydraDB using type=all where buyer memory matters
- Use metadata filters for hard constraints
- Use mode=thinking for graph-aware reasoning
- Use recency_bias high for current hire decision
- Use recency_bias low for long-term reliability view
```

Expected output:

```txt
recommended_agents
warn_agents
avoid_agents
reasoning_summary
evidence_chunks
risk_explanation
```

Acceptance:

```txt
- Demo task returns Agent B over Agent A despite Agent A having a higher average rating
- Explanation references recent skill-specific failures
- Buyer-specific recommendations work
```

---

## Phase H6 — Ingest RocketRide trust events

Tasks:

```txt
- Create backend endpoint or function that accepts trust_event_schema.json
- Validate event shape
- Convert event into HydraDB knowledge or memory record
- Attach tenant_metadata and additional_metadata correctly
- Optionally create relations to agent_id, skill_id, and job_id
```

Acceptance:

```txt
- Teammate can send one RocketRide-produced event
- HydraDB ingests it
- A later trust query reflects the new event
```

---

# RocketRide implementation plan — Teammate / Claude Code

## Goal

Build the pipeline runtime that turns raw marketplace/job activity into structured trust events.

## Phase R1 — RocketRide setup

Tasks:

```txt
- Install RocketRide SDK
- Configure ROCKETRIDE_URI and ROCKETRIDE_APIKEY
- Create a minimal .pipe pipeline
- Run pipeline locally or through RocketRide Cloud
- Send a sample input and receive output
```

Acceptance:

```txt
- Can run one RocketRide pipeline
- Can pass a sample event into the pipeline
- Can receive a structured output
```

---

## Phase R2 — Sample event format

Tasks:

```txt
- Create sample marketplace events
- Job completed event
- Job disputed event
- Refund issued event
- Repeat hire event
- Late delivery event
```

Sample raw event concepts:

```txt
buyer complaint text
worker response text
deliverable summary
task category
timestamps
price tier
SLA
rating
```

Acceptance:

```txt
- RocketRide pipeline can accept all sample event types
```

---

## Phase R3 — Event classification pipeline

Pipeline logic:

```txt
raw event
  ↓
parse event
  ↓
classify event type
  ↓
extract skill involved
  ↓
classify outcome
  ↓
generate edge type
  ↓
produce trust_event_schema.json
```

Example output:

```txt
edge_type = DISPUTED_BY
outcome = failed
skill_id = batch_pdf_extraction
reason = missed files in large PDF batch
```

Acceptance:

```txt
- Raw complaint text becomes a structured trust event
- Different event types create different edge types
```

---

## Phase R4 — Skill extraction pipeline

Pipeline logic:

```txt
task brief
  ↓
identify required skills
  ↓
return skill list
```

Example:

```txt
Input:
Extract structured data from 500 PDFs into CSV.

Output:
pdf_ocr
batch_pdf_extraction
table_extraction
schema_mapping
csv_generation
data_validation
```

Acceptance:

```txt
- Given a job brief, pipeline returns required skills
- Output matches skill_schema.json IDs where possible
```

---

## Phase R5 — PII/anonymization and production polish

Tasks:

```txt
- Add anonymization step for buyer/worker text if available
- Remove emails, names, account IDs from dispute text
- Keep enough context for classification
```

Acceptance:

```txt
- Dispute text is safe to store as trust evidence
```

---

## Phase R6 — Send result to backend

Tasks:

```txt
- Send structured trust event to backend endpoint
- Or write output to a JSON file for manual ingestion if integration is delayed
- Confirm Mohit's HydraDB layer can ingest the output
```

Acceptance:

```txt
- RocketRide output matches trust_event_schema.json
- HydraDB owner can ingest it without changing RocketRide code
```

---

# Frontend / demo responsibilities

Keep the frontend minimal.

Suggested owner: Mohit creates initial placeholder. Both can improve later only after backend contracts are stable.

## Required demo screens

```txt
1. Job input screen
2. Skill decomposition result
3. Candidate agents comparison
4. Trust recommendation output
5. Evidence / explanation panel
6. RocketRide pipeline trace or output panel
```

## Demo story

```txt
User asks:
Extract structured data from 500 PDFs into a clean CSV.

Naive result:
Agent A has 4.8 stars.

AgentProof result:
Recommend Agent B.

Why:
Agent A is good at OCR but has recent disputes on batch_pdf_extraction.
Agent B has stronger verified skill history for batch extraction and validation.
Buyer is risk-averse, so reliability beats average rating.
```

---

# No-conflict development rules

## Rule 1 — Boilerplate first

One person creates the boilerplate before parallel work starts.

## Rule 2 — Own your folder

```txt
Mohit edits hydradb/ and trust logic.
Teammate edits rocketride/ and pipeline logic.
```

## Rule 3 — Contracts are the only shared surface

Any change to these files must be communicated:

```txt
contracts/trust_event_schema.json
contracts/skill_schema.json
contracts/trust_recommendation_schema.json
```

## Rule 4 — Do not block each other

If RocketRide integration is not ready, Mohit uses sample trust event JSON.

If HydraDB ingestion is not ready, teammate writes pipeline output to JSON files.

## Rule 5 — Integration happens through files or API only

Preferred integration path:

```txt
RocketRide → backend endpoint → HydraDB
```

Fallback integration path:

```txt
RocketRide → sample JSON output → manual HydraDB ingest
```

---

# Suggested branches

```txt
main
feature/boilerplate
feature/hydradb-trust-layer
feature/rocketride-pipelines
feature/integration-demo
```

Merge order:

```txt
1. feature/boilerplate → main
2. feature/hydradb-trust-layer → main
3. feature/rocketride-pipelines → main
4. feature/integration-demo → main
```

---

# Integration checklist

Integration is ready when:

```txt
- RocketRide can produce trust_event_schema.json
- HydraDB can ingest trust_event_schema.json
- Trust query changes after ingesting a new trust event
- Frontend can show recommended / warn / avoid agents
- Demo story works end to end
```

---

# Final demo checklist

The final demo should show:

```txt
- Job decomposed into skills
- Agents compared by skill-level trust, not global rating
- HydraDB explanation with evidence
- Buyer-specific recommendation
- RocketRide pipeline converting raw event into trust signal
- New trust event changes future recommendation
```

---

# 90-second pitch

```txt
Agent marketplaces will not fail because users cannot find agents.
They will fail because users cannot trust agents.

AgentProof solves this by decomposing every job into skills and tracking which agents actually succeed or fail at those skills.

RocketRide turns raw agent work events into structured trust signals.
HydraDB stores those signals as skill-level reputation memory and reasons over them for each buyer.

So instead of asking, "Which agent has the best rating?" AgentProof answers, "Which agent is safe to hire for this exact skill, task, buyer, and risk level?"
```

---

# Build priority

If time is short, prioritize this order:

```txt
1. HydraDB seed data and trust query
2. Frontend demo for task → skills → recommendation
3. RocketRide pipeline producing one trust event
4. Integration where that event updates HydraDB
5. Buyer-specific personalization
6. Fancy UI polish
```

The most important proof is:

```txt
Agent A has a better rating, but AgentProof recommends Agent B because skill-level trust evidence says Agent B is safer for this exact task.
```
