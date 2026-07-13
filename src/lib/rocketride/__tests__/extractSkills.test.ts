import { describe, expect, it } from "vitest";

import { extractSkills } from "../extractSkills";

describe("extractSkills", () => {
  it("matches the canonical PDF demo brief to the expected skill sequence", () => {
    const brief = "Extract structured data from 500 PDFs into a clean CSV.";
    expect(extractSkills(brief)).toEqual([
      "pdf_ocr",
      "batch_pdf_extraction",
      "table_extraction",
      "schema_mapping",
      "csv_generation",
      "data_validation",
    ]);
  });

  it("does not fire unrelated skills for the PDF demo brief", () => {
    const brief = "Extract structured data from 500 PDFs into a clean CSV.";
    const skills = extractSkills(brief);
    expect(skills).not.toContain("citation_checking");
    expect(skills).not.toContain("web_research");
    expect(skills).not.toContain("code_review");
    expect(skills).not.toContain("sales_email_drafting");
  });

  it("matches an unrelated brief to its own domain", () => {
    const brief = "Draft a sales outreach email sequence for our new pricing tier.";
    expect(extractSkills(brief)).toEqual(["sales_email_drafting"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(extractSkills("Water the office plants every Monday.")).toEqual([]);
  });
});
