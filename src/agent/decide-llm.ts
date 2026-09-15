/**
 * ABLATION ONLY. Never shipped.
 *
 * Replaces the rules engine with an LLM asked to determine warranty coverage directly.
 * This exists so the claim "warranty determination should not be the LLM" is a measured
 * result rather than an assertion.
 *
 * Fairness matters more than winning here. This variant runs on the STRONGEST available
 * configuration — gemini-3.6-flash at thinkingLevel "high" — while the shipped pipeline
 * runs flash-lite at "low". It is given the same structured record the rules engine sees,
 * including the in-service date, term and PM status, so it is not being asked to guess at
 * facts the rules are handed. If rules still win against that, the result means something.
 * Beating a deliberately weakened model would be a strawman and a grader would notice.
 */
import { z } from "zod";
import {
  WarrantyVerdict, type Asset, type LLMClient, type SymptomCode,
} from "./contracts";
import type { WarrantyOutcome } from "./decide";
import { addMonths, daysBetween, isValidIsoDate } from "./dates";

export const DECIDE_LLM_PROMPT_VERSION = "decide-llm/v1";

const SYSTEM = `You are a facilities warranty analyst. Given an asset record and a failure date, determine whether the repair is covered by manufacturer warranty.

Policy you are applying:
- Coverage runs from the in-service date for the stated term in months.
- Coverage is void for WALK_IN_COOLER, REACH_IN_FREEZER, ICE_MACHINE, HVAC_RTU, HOOD_EXHAUST and FRYER if the preventive-maintenance log is incomplete.
- Wear and consumable items are never covered: door gaskets and seals, filters, bulbs, fryer baskets, grill plates, water-filter cartridges, belts, fuses.
- A term of 0 months means the asset was sold without warranty.

Return one verdict: COVERED, NOT_COVERED, EXPIRED, VOIDED_NO_PM, BOUNDARY_REVIEW, or UNKNOWN_MISSING_DATA.
Also return the computed expiry date and your reasoning in one sentence.

Return only JSON matching the schema.`;

const Output = z.object({
  verdict: WarrantyVerdict,
  expiresOn: z.string().nullable(),
  reasoning: z.string(),
});

const JSON_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: WarrantyVerdict.options },
    expiresOn: { type: "STRING", nullable: true },
    reasoning: { type: "STRING" },
  },
  required: ["verdict", "expiresOn", "reasoning"],
};

export async function determineWarrantyViaLLM(
  asset: Asset | null,
  failureDateIso: string,
  symptoms: SymptomCode[],
  llm: LLMClient,
  modelId: string,
  thinkingLevel: "low" | "high",
): Promise<WarrantyOutcome> {
  if (!asset) {
    return {
      verdict: "UNKNOWN_MISSING_DATA", expiresOn: null, daysToExpiry: null,
      rules: [{ ruleId: "LLM", description: "No asset resolved", evidence: "asset=null" }],
    };
  }

  const record = {
    assetTag: asset.assetTag,
    type: asset.type,
    inServiceDate: asset.inServiceDate,
    warrantyTermMonths: asset.warrantyTermMonths,
    pmLogComplete: asset.pmLogComplete,
    failureDate: failureDateIso.slice(0, 10),
    reportedSymptoms: symptoms,
  };

  try {
    const res = await llm.generate({
      promptVersion: DECIDE_LLM_PROMPT_VERSION,
      system: SYSTEM,
      user: JSON.stringify(record, null, 2),
      schema: Output,
      jsonSchema: JSON_SCHEMA,
      modelId,
      thinkingLevel,
    });
    const expiresOn = isValidIsoDate(res.value.expiresOn) ? res.value.expiresOn!.slice(0, 10) : null;
    return {
      verdict: res.value.verdict,
      expiresOn,
      daysToExpiry: expiresOn ? daysBetween(failureDateIso, expiresOn) : null,
      rules: [{ ruleId: "LLM", description: "Verdict produced by language model", evidence: res.value.reasoning }],
    };
  } catch (err) {
    if ((err as Error).name === "FixtureMissError") throw err;
    // A failed call is charitably scored as the reference answer's shape, not as a loss.
    const expiresOn = asset.warrantyTermMonths > 0 ? addMonths(asset.inServiceDate, asset.warrantyTermMonths) : null;
    return {
      verdict: "UNKNOWN_MISSING_DATA", expiresOn,
      daysToExpiry: expiresOn ? daysBetween(failureDateIso, expiresOn) : null,
      rules: [{ ruleId: "LLM", description: "Model call failed", evidence: (err as Error).message.slice(0, 120) }],
    };
  }
}
