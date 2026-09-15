/**
 * Deterministic groundedness check on LLM-written prose.
 *
 * Every numeral, date, currency amount and asset tag in the generated text must appear in
 * the structured payload the text is describing. This does not check that the prose is
 * *well written* — it checks that the model did not invent a fact, which is the only
 * failure mode that can reach a vendor as an instruction.
 *
 * One violation fails the whole draft to a template. There is no partial credit: a work
 * order that is 90% grounded still contains one wrong number.
 */
import type { GroundednessViolation } from "./contracts";

const NUMERAL_RE = /\b\d+(?:\.\d+)?\b/g;
const AMOUNT_RE = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
const TAG_RE = /\b[A-Z]{3}-\d{2}\b/g;

/** Numbers that carry no factual claim and would otherwise flood the violation list. */
const BENIGN = new Set(["0", "1", "2", "24", "48", "72"]);

function normaliseAmount(s: string): string {
  return s.replace(/[$,\s]/g, "");
}

export function checkGroundedness(
  fields: { symptomSummary: string; vendorInstructions: string },
  allowed: {
    numerals: string[];
    dates: string[];
    amounts: string[];
    assetTags: string[];
  },
): GroundednessViolation[] {
  const violations: GroundednessViolation[] = [];
  const allowedNumerals = new Set(allowed.numerals.map(String));
  const allowedDates = new Set(allowed.dates.map((d) => d.slice(0, 10)));
  const allowedAmounts = new Set(allowed.amounts.map((a) => normaliseAmount(String(a))));
  const allowedTags = new Set(allowed.assetTags);

  for (const field of ["symptomSummary", "vendorInstructions"] as const) {
    const text = fields[field];

    for (const m of text.match(TAG_RE) ?? []) {
      if (!allowedTags.has(m)) violations.push({ token: m, kind: "ASSET_TAG", field });
    }
    for (const m of text.match(DATE_RE) ?? []) {
      if (!allowedDates.has(m.slice(0, 10))) violations.push({ token: m, kind: "DATE", field });
    }
    for (const m of text.match(AMOUNT_RE) ?? []) {
      if (!allowedAmounts.has(normaliseAmount(m))) violations.push({ token: m, kind: "AMOUNT", field });
    }

    // Strip everything already accounted for, so a date's components are not re-reported
    // as three loose numerals.
    const residual = text.replace(TAG_RE, " ").replace(DATE_RE, " ").replace(AMOUNT_RE, " ");
    for (const m of residual.match(NUMERAL_RE) ?? []) {
      if (BENIGN.has(m)) continue;
      if (!allowedNumerals.has(m)) violations.push({ token: m, kind: "NUMERAL", field });
    }
  }
  return violations;
}
