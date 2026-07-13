import { describe, expect, it } from "vitest";

import { anonymizeText } from "../anonymize";

describe("anonymizeText", () => {
  it("redacts emails", () => {
    const { text, redacted } = anonymizeText("Contact jane.buyer@example.com for details.");
    expect(text).not.toContain("jane.buyer@example.com");
    expect(text).toContain("[redacted-email]");
    expect(redacted).toBe(true);
  });

  it("redacts phone numbers", () => {
    const { text, redacted } = anonymizeText("Call me at 415-555-0134 tomorrow.");
    expect(text).not.toContain("415-555-0134");
    expect(redacted).toBe(true);
  });

  it("redacts account-style IDs", () => {
    const { text, redacted } = anonymizeText("Refund applied to account 88213741.");
    expect(text).not.toContain("88213741");
    expect(redacted).toBe(true);
  });

  it("leaves clean text untouched and reports no redaction", () => {
    const { text, redacted } = anonymizeText("The delivered CSV omitted 43 documents from the batch.");
    expect(text).toBe("The delivered CSV omitted 43 documents from the batch.");
    expect(redacted).toBe(false);
  });
});
