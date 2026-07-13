import { describe, expect, it } from "vitest";

import sampleTrustEvent from "../../../../rocketride/samples/trust-event.sample.json";
import { validateSkill, validateTrustEvent } from "../validate";

describe("validateTrustEvent", () => {
  it("accepts the canonical sample trust event", () => {
    expect(validateTrustEvent(sampleTrustEvent)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a missing required field", () => {
    const { reason: _reason, ...withoutReason } = sampleTrustEvent as typeof sampleTrustEvent & {
      reason: string;
    };
    const result = validateTrustEvent(withoutReason);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an invalid enum value", () => {
    const result = validateTrustEvent({ ...sampleTrustEvent, edge_type: "NOT_A_REAL_EDGE" });
    expect(result.valid).toBe(false);
  });

  it("rejects unknown extra fields (additionalProperties: false)", () => {
    const result = validateTrustEvent({ ...sampleTrustEvent, extra_field: "nope" });
    expect(result.valid).toBe(false);
  });
});

describe("validateSkill", () => {
  it("accepts a well-formed skill", () => {
    const skill = {
      skill_id: "pdf_ocr",
      name: "PDF OCR",
      description: "Extract text from scanned or image-based PDFs.",
      category: "document_processing",
      input_type: "pdf",
      output_type: "text",
      risk_level: "medium",
      difficulty: "intermediate",
      dependencies: [],
      typical_failure_modes: ["low_scan_quality"],
      evaluation_criteria: ["text_accuracy"],
      source: "agentproof_seed",
    };
    expect(validateSkill(skill)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a skill_id that violates the id pattern", () => {
    const result = validateSkill({
      skill_id: "Not Valid!",
      name: "x",
      description: "x",
      category: "x",
      input_type: "x",
      output_type: "x",
      risk_level: "low",
      difficulty: "beginner",
      dependencies: [],
      typical_failure_modes: [],
      evaluation_criteria: [],
      source: "x",
    });
    expect(result.valid).toBe(false);
  });
});
