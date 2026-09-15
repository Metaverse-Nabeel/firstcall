/**
 * Stage 3 — DECIDE. Deterministic rules engine implementing docs/warranty-policy.md.
 *
 * Why this is not the LLM, restated where the code lives:
 *
 *  1. It is date arithmetic over structured fields, not language. EXTRACT already consumed
 *     the language; there is nothing left here for a language model to do.
 *  2. It is the money metric. Behind a stochastic function it becomes unimprovable by
 *     engineering — you can only re-prompt and hope. Rules give a failing case a line number.
 *  3. It is a disputed financial claim. The audit trail has to read "W-12, W-04 fired,
 *     in-service 2024-03-11, term 24mo, PM log complete" when a manufacturer pushes back.
 *
 * Rule IDs here match the policy document exactly. If they drift, the audit trail lies.
 */
import type {
  Asset, DecisionResult, ExtractionResult, FiredRule, PipelineConfig, Registry,
  ResolutionResult, Route, Severity, SymptomCode, WarrantyVerdict,
} from "./contracts";
import { addHours, addMonths, daysBetween, isValidIsoDate } from "./dates";

/** Classes whose manufacturer warranty is conditional on a complete PM log. Policy §3. */
const PM_REQUIRED = new Set([
  "WALK_IN_COOLER", "REACH_IN_FREEZER", "ICE_MACHINE", "HVAC_RTU", "HOOD_EXHAUST", "FRYER",
]);

/** Policy §4. Never covered regardless of window. */
const WEAR_SYMPTOMS = new Set<SymptomCode>(["DOOR_SEAL_FAIL", "CLOGGED_DRAIN"]);

const CRITICAL_SAFETY = new Set(["SMOKE_OR_FIRE", "GAS_SMELL", "CO_ALARM", "ELECTRICAL_ARCING", "STRUCTURAL_HAZARD"]);

const LONG_JOB_TYPES = new Set(["HVAC_RTU", "WALK_IN_COOLER"]);

/* ------------------------------------------------------------------ warranty */

export interface WarrantyOutcome {
  verdict: WarrantyVerdict;
  expiresOn: string | null;
  daysToExpiry: number | null;
  rules: FiredRule[];
}

export function determineWarranty(
  asset: Asset | null,
  failureDateIso: string,
  symptoms: SymptomCode[],
  boundaryDays: number,
): WarrantyOutcome {
  const rules: FiredRule[] = [];
  const fire = (ruleId: string, description: string, evidence: string) => {
    rules.push({ ruleId, description, evidence });
  };

  if (!asset) {
    fire("W-03", "Required field missing or UNKNOWN", "asset not resolved");
    return { verdict: "UNKNOWN_MISSING_DATA", expiresOn: null, daysToExpiry: null, rules };
  }

  // W-03 / W-09 dominate everything. The system must never reason past a hole in the
  // record — a defaulted join is the single most common cause of warranty leakage.
  if (!isValidIsoDate(asset.inServiceDate)) {
    fire("W-03", "Required field missing or UNKNOWN", `inServiceDate=${String(asset.inServiceDate)}`);
    return { verdict: "UNKNOWN_MISSING_DATA", expiresOn: null, daysToExpiry: null, rules };
  }
  if (typeof asset.warrantyTermMonths !== "number") {
    fire("W-03", "Required field missing or UNKNOWN", "warrantyTermMonths missing");
    return { verdict: "UNKNOWN_MISSING_DATA", expiresOn: null, daysToExpiry: null, rules };
  }
  if (PM_REQUIRED.has(asset.type) && asset.pmLogComplete === null) {
    fire("W-09", "PM log itself is missing (distinct from a known-incomplete log)", `${asset.assetTag} pmLogComplete=null`);
    return { verdict: "UNKNOWN_MISSING_DATA", expiresOn: null, daysToExpiry: null, rules };
  }

  if (asset.warrantyTermMonths === 0) {
    fire("W-04", "Asset sold without manufacturer warranty", `${asset.assetTag} term=0mo`);
    return { verdict: "NOT_COVERED", expiresOn: null, daysToExpiry: null, rules };
  }

  const expiresOn = addMonths(asset.inServiceDate, asset.warrantyTermMonths);
  fire("W-01", "Coverage window computed from in-service date and term",
    `in-service ${asset.inServiceDate} + ${asset.warrantyTermMonths}mo = ${expiresOn}`);

  const daysToExpiry = daysBetween(failureDateIso, expiresOn);
  fire("W-02", "Failure date is the report date", `reported ${failureDateIso.slice(0, 10)}, ${daysToExpiry}d from expiry`);

  // W-07 before W-08/W-05: the boundary band is where money is lost and where every
  // downstream signal is least reliable, so it gates before any other conclusion is drawn.
  if (Math.abs(daysToExpiry) <= boundaryDays) {
    fire("W-07", `Failure within +/-${boundaryDays}d of expiry — always reviewed by a human`,
      `${Math.abs(daysToExpiry)}d ${daysToExpiry >= 0 ? "before" : "after"} expiry ${expiresOn}`);
    return { verdict: "BOUNDARY_REVIEW", expiresOn, daysToExpiry, rules };
  }

  if (PM_REQUIRED.has(asset.type) && asset.pmLogComplete === false) {
    fire("W-08", "Coverage forfeited: PM log incomplete for a PM-conditional asset class",
      `${asset.type} requires PM; log incomplete`);
    return { verdict: "VOIDED_NO_PM", expiresOn, daysToExpiry, rules };
  }

  if (daysToExpiry < 0) {
    fire("W-05", "Failure after expiry", `expired ${Math.abs(daysToExpiry)}d before the report`);
    return { verdict: "EXPIRED", expiresOn, daysToExpiry, rules };
  }

  // W-10 only fires when the wear item is the WHOLE story. A torn gasket alongside a
  // failed compressor rides along on the covered fault's work order.
  const nonWear = symptoms.filter((s) => !WEAR_SYMPTOMS.has(s));
  if (symptoms.length > 0 && nonWear.length === 0) {
    fire("W-10", "Fault is a wear/consumable item, excluded regardless of window",
      `symptoms: ${symptoms.join(", ")}`);
    return { verdict: "NOT_COVERED", expiresOn, daysToExpiry, rules };
  }

  fire("W-12", "Inside the coverage window with PM satisfied", `${daysToExpiry}d remaining`);
  return { verdict: "COVERED", expiresOn, daysToExpiry, rules };
}

/* ------------------------------------------------------------------ severity */

export function deriveSeverity(extraction: ExtractionResult): Severity {
  // A critical hazard overrides whatever the report's tone implied. Under-calling severity
  // is the expensive direction, so this is a floor, not an average.
  if (extraction.safetyIndicators.some((s) => CRITICAL_SAFETY.has(s))) return "CRITICAL";
  if (extraction.severityHint) return extraction.severityHint;
  if (extraction.safetyIndicators.length > 0) return "HIGH";
  if (extraction.symptomCodes.includes("COMPLETE_FAILURE")) return "HIGH";
  if (extraction.reportedDowntime) return "HIGH";
  if (extraction.symptomCodes.length === 0) return "LOW";
  return "MEDIUM";
}

/* ------------------------------------------------------------------ vendor + cost */

function findVendor(registry: Registry, asset: Asset | null) {
  if (!asset) return null;
  return registry.vendors.find(
    (v) => v.coversTypes.includes(asset.type) && v.coversStores.includes(asset.storeId),
  ) ?? null;
}

export function computeCostExposure(asset: Asset | null, registry: Registry): number {
  if (!asset) return 0;
  const vendor = findVendor(registry, asset);
  if (!vendor) return 0;
  const hours = LONG_JOB_TYPES.has(asset.type) ? 4 : 2;
  return Math.round(vendor.callOutFee + vendor.hourlyRate * hours + asset.typicalRepairCost);
}

/* ------------------------------------------------------------------ routing */

interface RoutingInput {
  verdict: WarrantyVerdict;
  severity: Severity;
  hasSafety: boolean;
  ambiguous: boolean;
  notInRegistry: boolean;
  multiAsset: boolean;
  costExposure: number;
  costGate: number;
  hasVendor: boolean;
  symptoms: SymptomCode[];
}

/**
 * Policy §5, evaluated top-down, first match wins.
 *
 * The autonomy column is the policy: no row that spends money is autonomous. This array
 * is the single place routing is decided, which is what makes it unit-testable and what
 * makes the confusion matrix meaningful.
 */
export const ROUTING_TABLE: ReadonlyArray<{
  id: string; when: (i: RoutingInput) => boolean; route: Route; why: string;
}> = [
  { id: "R-01", when: (i) => i.hasSafety && i.severity === "CRITICAL", route: "EMERGENCY_DISPATCH", why: "Safety hazard at critical severity" },
  { id: "R-02", when: (i) => i.hasSafety, route: "ESCALATE_HUMAN", why: "Safety indicator raised" },
  { id: "R-03", when: (i) => i.verdict === "UNKNOWN_MISSING_DATA", route: "ESCALATE_HUMAN", why: "Warranty undeterminable from available data" },
  { id: "R-04", when: (i) => i.ambiguous || i.notInRegistry || !i.hasVendor, route: "ESCALATE_HUMAN", why: "Asset ambiguous, absent, or no covering vendor" },
  { id: "R-05", when: (i) => i.multiAsset, route: "ESCALATE_HUMAN", why: "Multiple assets in one report" },
  { id: "R-06", when: (i) => i.verdict === "BOUNDARY_REVIEW", route: "ESCALATE_HUMAN", why: "Failure within the warranty boundary band" },
  { id: "R-08", when: (i) => i.costExposure > i.costGate, route: "ESCALATE_HUMAN", why: "Cost exposure above the autonomy ceiling" },
  { id: "R-11", when: (i) => i.verdict === "VOIDED_NO_PM", route: "ESCALATE_HUMAN", why: "Coverage voided by PM gap — a money decision" },
  { id: "R-13", when: (i) => i.symptoms.length === 0, route: "NO_ACTION", why: "No actionable symptom reported" },
  { id: "R-09", when: (i) => i.verdict === "COVERED" && i.severity === "CRITICAL", route: "WARRANTY_CLAIM", why: "Covered, expedited" },
  { id: "R-10", when: (i) => i.verdict === "COVERED", route: "WARRANTY_CLAIM", why: "Covered by manufacturer warranty" },
  { id: "R-12", when: (i) => i.verdict === "NOT_COVERED" && (i.severity === "LOW" || i.severity === "MEDIUM"), route: "IN_HOUSE_FIX", why: "Wear item, store-level fix" },
  { id: "R-14", when: (i) => i.severity === "CRITICAL", route: "EMERGENCY_DISPATCH", why: "Not covered, critical severity" },
  { id: "R-15", when: () => true, route: "VENDOR_DISPATCH", why: "Not covered — paid vendor repair" },
];

export function applyRouting(input: RoutingInput): { route: Route; rule: FiredRule } {
  for (const row of ROUTING_TABLE) {
    if (row.when(input)) {
      return {
        route: row.route,
        rule: { ruleId: row.id, description: row.why, evidence: `verdict=${input.verdict} severity=${input.severity} safety=${input.hasSafety} cost=$${input.costExposure}` },
      };
    }
  }
  /* c8 ignore next */ throw new Error("ROUTING_TABLE has no terminal row — unreachable");
}

/* ------------------------------------------------------------------ stage */

export function decide(
  extraction: ExtractionResult,
  resolution: ResolutionResult,
  report: { reportedAt: string },
  registry: Registry,
  config: PipelineConfig,
): DecisionResult {
  const asset = resolution.resolved;
  const warranty = determineWarranty(asset, report.reportedAt, extraction.symptomCodes, config.warrantyBoundaryDays);
  const severity = deriveSeverity(extraction);
  const costExposure = computeCostExposure(asset, registry);
  const vendor = findVendor(registry, asset);

  const { route, rule } = applyRouting({
    verdict: warranty.verdict,
    severity,
    hasSafety: extraction.safetyIndicators.length > 0,
    ambiguous: resolution.ambiguous,
    notInRegistry: resolution.notInRegistry,
    multiAsset: resolution.multiAsset,
    costExposure,
    costGate: config.costGateUsd,
    hasVendor: vendor !== null,
    symptoms: extraction.symptomCodes,
  });

  const needsVendor = route === "VENDOR_DISPATCH" || route === "EMERGENCY_DISPATCH";
  const slaHours = vendor ? (route === "EMERGENCY_DISPATCH" ? vendor.slaHoursEmergency : vendor.slaHoursStandard) : null;

  return {
    warrantyVerdict: warranty.verdict,
    warrantyExpiresOn: warranty.expiresOn,
    daysToWarrantyExpiry: warranty.daysToExpiry,
    severity,
    route,
    costExposure,
    assignedVendorId: needsVendor && vendor ? vendor.vendorId : null,
    slaDeadline: vendor && slaHours !== null ? addHours(report.reportedAt, slaHours) : null,
    rulesFired: [...warranty.rules, rule],
    // Confidence in a deterministic stage is binary: either every input was present, or
    // it was not. There is no middle value to express and inventing one would be noise.
    cDecide: warranty.verdict === "UNKNOWN_MISSING_DATA" ? 0 : 1,
  };
}
