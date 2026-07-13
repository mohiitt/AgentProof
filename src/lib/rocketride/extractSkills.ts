import { SKILL_TRIGGERS } from "./skillTaxonomy";

/**
 * R4: job brief -> required skill_ids. This is the deterministic fallback
 * used when no LLM node is available; the real .pipe adds an llm_gemini node
 * for phrasing the keyword matcher can't cover, post-filtered to this same
 * skill_id taxonomy.
 */
export function extractSkills(brief: string): string[] {
  return SKILL_TRIGGERS.filter((trigger) => trigger.test(brief)).map((trigger) => trigger.skill_id);
}
