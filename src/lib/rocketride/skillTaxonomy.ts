/**
 * Keyword triggers for the R4 deterministic fallback. Order defines the
 * emitted skill order. IDs must match contracts/skill_schema.json entries.
 */
export interface SkillTrigger {
  skill_id: string;
  test: (brief: string) => boolean;
}

const hasDigits = /\d/;

export const SKILL_TRIGGERS: SkillTrigger[] = [
  { skill_id: "pdf_ocr", test: (b) => /pdf/i.test(b) },
  {
    skill_id: "batch_pdf_extraction",
    test: (b) => /pdf/i.test(b) && (/batch/i.test(b) || hasDigits.test(b)),
  },
  { skill_id: "table_extraction", test: (b) => /structured|table/i.test(b) },
  {
    skill_id: "schema_mapping",
    test: (b) => /schema/i.test(b) || (/structured/i.test(b) && /csv/i.test(b)),
  },
  { skill_id: "csv_generation", test: (b) => /csv/i.test(b) },
  { skill_id: "data_validation", test: (b) => /valid|clean|accura/i.test(b) },
  { skill_id: "citation_checking", test: (b) => /citation|reference/i.test(b) },
  { skill_id: "web_research", test: (b) => /research|web search/i.test(b) },
  { skill_id: "vc_memo_writing", test: (b) => /memo|investment thesis/i.test(b) },
  { skill_id: "code_review", test: (b) => /code review|pull request/i.test(b) },
  { skill_id: "sales_email_drafting", test: (b) => /sales email|outreach email/i.test(b) },
];
