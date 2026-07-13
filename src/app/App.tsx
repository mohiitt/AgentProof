import { OwnershipCard } from "../components/OwnershipCard";

const stages = [
  ["01", "Describe the job", "A buyer supplies a task and risk context."],
  ["02", "Resolve the skills", "The task is decomposed into checkable capabilities."],
  ["03", "Compare evidence", "HydraDB reasons over skill-level trust history."],
  ["04", "Recommend safely", "AgentProof returns hire, warn, and avoid groups."],
] as const;

export function App() {
  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="AgentProof home">
          <span className="brand-mark">AP</span>
          AgentProof
        </a>
        <span className="status"><i /> Boilerplate ready</span>
      </nav>

      <section className="hero" id="top">
        <p className="eyebrow">Trust infrastructure for agent marketplaces</p>
        <h1>Hire for proven skills,<br /><em>not a star average.</em></h1>
        <p className="lede">
          AgentProof turns marketplace outcomes into skill-level evidence and
          recommends the safest agent for this buyer, job, and risk level.
        </p>
        <div className="demo-prompt">
          <span>Demo task</span>
          <p>Extract structured data from 500 PDFs into a clean CSV.</p>
        </div>
      </section>

      <section className="flow" aria-labelledby="flow-title">
        <div className="section-heading">
          <p className="eyebrow">Planned product flow</p>
          <h2 id="flow-title">From task brief to defensible recommendation</h2>
        </div>
        <div className="stage-grid">
          {stages.map(([number, title, body]) => (
            <article className="stage" key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ownership" aria-labelledby="ownership-title">
        <div className="section-heading">
          <p className="eyebrow">Independent workstreams</p>
          <h2 id="ownership-title">One contract. Two owners.</h2>
        </div>
        <div className="ownership-grid">
          <OwnershipCard
            accent="violet"
            owner="Mohit + Codex"
            system="HydraDB"
            description="Trust memory, skill reputation, buyer preferences, and recommendation reasoning."
            paths={["hydradb/", "src/server/trust/", "src/lib/trust/"]}
          />
          <OwnershipCard
            accent="amber"
            owner="Teammate + Claude Code"
            system="RocketRide"
            description="Marketplace event parsing, skill extraction, anonymization, and trust-event output."
            paths={["rocketride/", "src/server/rocketride/", "src/lib/rocketride/"]}
          />
        </div>
        <div className="contract-seam">
          <span>Shared seam</span>
          <code>RocketRide → trust_event_schema.json → HydraDB</code>
        </div>
      </section>
    </main>
  );
}
