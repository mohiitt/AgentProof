export interface AnonymizeResult {
  text: string;
  redacted: boolean;
}

const PATTERNS: Array<[RegExp, string]> = [
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted-email]"],
  [/\b(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[redacted-phone]"],
  [/\b(?:acct|account|user|usr|order|invoice)[_#\s-]?\d{3,}\b/gi, "[redacted-id]"],
  [/@[A-Za-z0-9_]{2,}/g, "[redacted-handle]"],
];

/**
 * Deterministic PII scrub for free-text fields (complaints, notes) before
 * they become trust evidence. Mirrors the RocketRide "Anonymize" node so the
 * offline mapper and the real pipeline produce the same output.
 */
export function anonymizeText(text: string): AnonymizeResult {
  let result = text;
  let redacted = false;

  for (const [pattern, replacement] of PATTERNS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) redacted = true;
  }

  return { text: result, redacted };
}
