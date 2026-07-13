# RocketRide workstream

Owned by the teammate using Claude Code. Pipeline definitions belong in
`pipelines/`, and stable sample inputs and outputs belong in `samples/`.

Every produced trust event must validate against
`../contracts/trust_event_schema.json`. Until HydraDB ingestion is available,
write pipeline output to `samples/` so Mohit can consume it independently.
