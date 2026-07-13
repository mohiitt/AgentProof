import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import trustEventSchema from "../../../contracts/trust_event_schema.json";
import skillSchema from "../../../contracts/skill_schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validateTrustEventImpl = ajv.compile(trustEventSchema);
const validateSkillImpl = ajv.compile(skillSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function toResult(validator: ValidateFunction, data: unknown): ValidationResult {
  const valid = validator(data);
  return {
    valid,
    errors: valid ? [] : formatErrors(validator.errors),
  };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`);
}

export function validateTrustEvent(data: unknown): ValidationResult {
  return toResult(validateTrustEventImpl, data);
}

export function validateSkill(data: unknown): ValidationResult {
  return toResult(validateSkillImpl, data);
}

export function assertValidTrustEvent(data: unknown): void {
  const result = validateTrustEvent(data);
  if (!result.valid) {
    throw new Error(`Invalid TrustEvent: ${result.errors.join("; ")}`);
  }
}

export function assertValidSkill(data: unknown): void {
  const result = validateSkill(data);
  if (!result.valid) {
    throw new Error(`Invalid Skill: ${result.errors.join("; ")}`);
  }
}
