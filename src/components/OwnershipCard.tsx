type OwnershipCardProps = {
  accent: "violet" | "amber";
  owner: string;
  system: string;
  description: string;
  paths: string[];
};

export function OwnershipCard({
  accent,
  owner,
  system,
  description,
  paths,
}: OwnershipCardProps) {
  return (
    <article className={`owner-card ${accent}`}>
      <p className="owner-label">{owner}</p>
      <h3>{system}</h3>
      <p>{description}</p>
      <ul aria-label={`${system} owned paths`}>
        {paths.map((path) => <li key={path}><code>{path}</code></li>)}
      </ul>
    </article>
  );
}
