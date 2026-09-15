/**
 * Stage 5 — GATE. Deterministic. Decides whether a human sees this before anything happens.
 *
 * Cheapest stage in the pipeline and the clearest evidence of operating judgment in it.
 */
import type {
  DecisionResult, DraftResult, ExtractionResult, GateReason, GateResult,
  PipelineConfig, ResolutionResult,
} from "./contracts";

/** Routes that spend money. No confidence score unlocks these — see policy §5. */
const SPENDS_MONEY = new Set(["VENDOR_DISPATCH", "EMERGENCY_DISPATCH"]);

export function gate(
  extraction: ExtractionResult,
  resolution: ResolutionResult,
  decision: DecisionResult,
  draftResult: DraftResult,
  config: PipelineConfig,
): GateResult {
  const parts = [
    { name: "EXTRACT" as const, c: extraction.cExtract },
    { name: "RETRIEVE" as const, c: resolution.cResolve },
    { name: "DECIDE" as const, c: decision.cDecide },
    { name: "DRAFT" as const, c: draftResult.cDraft },
  ];

  // min, not product. The product of four plausible scores is an uninterpretable number;
  // the min names the weak link, and the weak link is what the escalation note has to say.
  const weakest = parts.reduce((lo, p) => (p.c < lo.c ? p : lo));
  const confidence = Number(weakest.c.toFixed(4));

  const hardGates: GateReason[] = [];
  if (extraction.safetyIndicators.length > 0) hardGates.push("SAFETY_FLAG");
  if (extraction.usedLexiconFallback) hardGates.push("EXTRACTION_FALLBACK");
  if (resolution.ambiguous) hardGates.push("AMBIGUOUS_ASSET");
  if (resolution.notInRegistry) hardGates.push("NOT_IN_REGISTRY");
  if (resolution.multiAsset) hardGates.push("MULTI_ASSET");
  if (decision.warrantyVerdict === "UNKNOWN_MISSING_DATA") hardGates.push("MISSING_DATA");
  if (decision.warrantyVerdict === "BOUNDARY_REVIEW") hardGates.push("WARRANTY_BOUNDARY");
  if (decision.costExposure > config.costGateUsd) hardGates.push("COST_THRESHOLD");

  const belowThreshold = confidence < config.gateThreshold;
  if (belowThreshold) hardGates.push("LOW_CONFIDENCE");

  // The structural rule, enforced here rather than trusted upstream: a route that spends
  // money is never autonomous, whatever the score says. Defence in depth — R-01/R-14/R-15
  // already require a human, and this makes a routing-table edit unable to quietly
  // introduce autonomous spending.
  const spends = SPENDS_MONEY.has(decision.route);

  const decisionValue = hardGates.length > 0 || spends
    ? (hardGates.includes("SAFETY_FLAG") || hardGates.includes("MISSING_DATA") || hardGates.includes("NOT_IN_REGISTRY")
        ? "ESCALATE" : "REVIEW")
    : "AUTONOMOUS";

  return {
    decision: decisionValue,
    confidence,
    weakestLink: weakest.name,
    hardGates,
    threshold: config.gateThreshold,
    explanation: buildExplanation(decisionValue, weakest.name, confidence, hardGates, spends, decision.route),
  };
}

function buildExplanation(
  decision: string, weakest: string, confidence: number,
  hardGates: GateReason[], spends: boolean, route: string,
): string {
  if (decision === "AUTONOMOUS") {
    return `Handled automatically. Weakest stage ${weakest} at ${confidence.toFixed(2)}, above threshold, and ${route} commits no spend.`;
  }
  const reasons: string[] = [];
  if (spends) reasons.push(`${route} commits spend, which always requires a person`);
  for (const g of hardGates) reasons.push(HUMAN_READABLE[g]);
  return `${decision === "ESCALATE" ? "Escalated" : "Sent for review"}: ${reasons.join("; ")}. Weakest stage ${weakest} at ${confidence.toFixed(2)}.`;
}

const HUMAN_READABLE: Record<GateReason, string> = {
  SAFETY_FLAG: "a safety indicator was reported",
  AMBIGUOUS_ASSET: "the asset reference matches more than one unit at this store",
  NOT_IN_REGISTRY: "no matching asset in the registry",
  MISSING_DATA: "warranty could not be determined from the available record",
  COST_THRESHOLD: "cost exposure is above the autonomy ceiling",
  MULTI_ASSET: "the report covers more than one asset",
  WARRANTY_BOUNDARY: "the failure date falls within the warranty boundary band",
  LOW_CONFIDENCE: "confidence is below the configured threshold",
  EXTRACTION_FALLBACK: "structured extraction failed and the keyword fallback was used",
};
