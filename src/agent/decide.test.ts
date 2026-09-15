/**
 * Unit tests for the rules engine, written against docs/warranty-policy.md rather than
 * against the implementation. These are the "rule correctness" half of the evaluation —
 * separate from pipeline correctness, because eval labels derived from these same rules
 * cannot validate the rules themselves.
 */
import { describe, expect, it } from "vitest";
import { determineWarranty, applyRouting, deriveSeverity, ROUTING_TABLE } from "./decide";
import type { Asset, ExtractionResult, Route, Severity, WarrantyVerdict } from "./contracts";
import { addMonths } from "./dates";

const FAILURE = "2026-06-01T09:00:00Z";
const BOUNDARY_DAYS = 30;

function asset(over: Partial<Asset> = {}): Asset {
  return {
    assetId: "A-1000-FRY-01", storeId: "S-1000", assetTag: "FRY-01", type: "FRYER",
    manufacturer: "Frymaster", model: "FPP-345", serial: "FRY123456", ordinal: 1,
    location: "front line", inServiceDate: "2025-01-15", warrantyTermMonths: 24,
    pmLogComplete: true, replacementCost: 9000, typicalRepairCost: 700, ...over,
  };
}

/** in-service date that puts expiry exactly `days` from the failure date. */
function inServiceForOffset(days: number, term = 24): string {
  const expiry = new Date(FAILURE);
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return addMonths(expiry.toISOString().slice(0, 10), -term);
}

const verdictOf = (a: Asset | null, symptoms: ExtractionResult["symptomCodes"] = ["NOT_HEATING"]): WarrantyVerdict =>
  determineWarranty(a, FAILURE, symptoms, BOUNDARY_DAYS).verdict;

describe("W-01/W-12 coverage window", () => {
  it("covers a failure well inside the term", () => {
    expect(verdictOf(asset({ inServiceDate: inServiceForOffset(300) }))).toBe("COVERED");
  });

  it("expires a failure well outside the term", () => {
    expect(verdictOf(asset({ inServiceDate: inServiceForOffset(-300) }))).toBe("EXPIRED");
  });

  it("clamps month arithmetic to month end rather than rolling over", () => {
    // 31 Jan + 1 month must be 28 Feb, not 3 March. A roll-over silently extends coverage.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
});

describe("W-07 boundary band — the money rule", () => {
  for (const offset of [0, 1, -1, 29, -29, 30, -30]) {
    it(`gates a failure ${offset}d from expiry`, () => {
      expect(verdictOf(asset({ inServiceDate: inServiceForOffset(offset) }))).toBe("BOUNDARY_REVIEW");
    });
  }
  it("does not gate at 31d inside", () => {
    expect(verdictOf(asset({ inServiceDate: inServiceForOffset(31) }))).toBe("COVERED");
  });
  it("takes precedence over a PM gap", () => {
    // Boundary must win: it gates to a human, which is the cheap-to-be-wrong outcome.
    expect(verdictOf(asset({ inServiceDate: inServiceForOffset(5), pmLogComplete: false }))).toBe("BOUNDARY_REVIEW");
  });
});

describe("W-03/W-09 missing data dominates", () => {
  it("returns UNKNOWN when the asset is unresolved", () => {
    expect(verdictOf(null)).toBe("UNKNOWN_MISSING_DATA");
  });
  it("returns UNKNOWN for an invalid in-service date", () => {
    expect(verdictOf(asset({ inServiceDate: "not-a-date" }))).toBe("UNKNOWN_MISSING_DATA");
  });
  it("distinguishes a missing PM log (W-09) from an incomplete one (W-08)", () => {
    const base = { inServiceDate: inServiceForOffset(300) };
    expect(verdictOf(asset({ ...base, pmLogComplete: null }))).toBe("UNKNOWN_MISSING_DATA");
    expect(verdictOf(asset({ ...base, pmLogComplete: false }))).toBe("VOIDED_NO_PM");
  });
  it("ignores PM status for classes that do not require it", () => {
    expect(verdictOf(asset({ type: "POS_TERMINAL", inServiceDate: inServiceForOffset(300), pmLogComplete: false }))).toBe("COVERED");
  });
});

describe("W-04 / W-10 exclusions", () => {
  it("treats a zero-month term as NOT_COVERED", () => {
    expect(verdictOf(asset({ warrantyTermMonths: 0 }))).toBe("NOT_COVERED");
  });
  it("excludes a wear item that is the whole fault", () => {
    expect(verdictOf(asset({ inServiceDate: inServiceForOffset(300) }), ["DOOR_SEAL_FAIL"])).toBe("NOT_COVERED");
  });
  it("does NOT exclude when a wear item accompanies a covered fault", () => {
    expect(verdictOf(asset({ inServiceDate: inServiceForOffset(300) }), ["DOOR_SEAL_FAIL", "NOT_COOLING"])).toBe("COVERED");
  });
});

describe("routing table", () => {
  const base = {
    verdict: "COVERED" as WarrantyVerdict, severity: "MEDIUM" as Severity, hasSafety: false,
    ambiguous: false, notInRegistry: false, multiAsset: false,
    costExposure: 500, costGate: 2500, hasVendor: true, symptoms: ["NOT_HEATING" as const],
  };
  const routeOf = (over: Partial<typeof base>): Route => applyRouting({ ...base, ...over }).route;

  it("sends critical safety to emergency dispatch", () => {
    expect(routeOf({ hasSafety: true, severity: "CRITICAL" })).toBe("EMERGENCY_DISPATCH");
  });
  it("escalates any other safety flag", () => {
    expect(routeOf({ hasSafety: true, severity: "LOW" })).toBe("ESCALATE_HUMAN");
  });
  it("escalates missing data, ambiguity, absent vendor and multi-asset", () => {
    expect(routeOf({ verdict: "UNKNOWN_MISSING_DATA" })).toBe("ESCALATE_HUMAN");
    expect(routeOf({ ambiguous: true })).toBe("ESCALATE_HUMAN");
    expect(routeOf({ notInRegistry: true })).toBe("ESCALATE_HUMAN");
    expect(routeOf({ hasVendor: false })).toBe("ESCALATE_HUMAN");
    expect(routeOf({ multiAsset: true })).toBe("ESCALATE_HUMAN");
  });
  it("escalates a boundary verdict and a voided-PM verdict", () => {
    expect(routeOf({ verdict: "BOUNDARY_REVIEW" })).toBe("ESCALATE_HUMAN");
    expect(routeOf({ verdict: "VOIDED_NO_PM" })).toBe("ESCALATE_HUMAN");
  });
  it("escalates above the cost ceiling", () => {
    expect(routeOf({ costExposure: 2501 })).toBe("ESCALATE_HUMAN");
  });
  it("files a warranty claim when covered", () => {
    expect(routeOf({})).toBe("WARRANTY_CLAIM");
    expect(routeOf({ severity: "CRITICAL" })).toBe("WARRANTY_CLAIM");
  });
  it("returns NO_ACTION when nothing actionable was reported", () => {
    expect(routeOf({ symptoms: [] })).toBe("NO_ACTION");
  });
  it("dispatches a paid vendor only when not covered", () => {
    expect(routeOf({ verdict: "EXPIRED" })).toBe("VENDOR_DISPATCH");
    expect(routeOf({ verdict: "EXPIRED", severity: "CRITICAL" })).toBe("EMERGENCY_DISPATCH");
  });

  /**
   * The load-bearing invariant. If any COVERED case can reach a paid-vendor route, the
   * product's entire reason to exist is gone — so it is asserted exhaustively rather than
   * spot-checked.
   */
  it("NEVER routes a COVERED asset to a paid vendor, across the full input space", () => {
    const severities: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    for (const severity of severities) {
      for (const hasSafety of [true, false]) {
        for (const costExposure of [0, 100, 2499, 2500, 2501, 99999]) {
          for (const symptoms of [[], ["NOT_HEATING" as const]]) {
            const route = routeOf({ verdict: "COVERED", severity, hasSafety, costExposure, symptoms });
            if (route === "VENDOR_DISPATCH") {
              throw new Error(`COVERED leaked to VENDOR_DISPATCH at ${JSON.stringify({ severity, hasSafety, costExposure })}`);
            }
            // EMERGENCY_DISPATCH is reachable via R-01 on a critical safety hazard, which
            // is correct: a gas leak is attended first and billed afterwards. It is never
            // autonomous, so it is not leakage.
            if (route === "EMERGENCY_DISPATCH") expect(hasSafety && severity === "CRITICAL").toBe(true);
          }
        }
      }
    }
  });

  it("has a terminal catch-all row so routing is total", () => {
    expect(ROUTING_TABLE[ROUTING_TABLE.length - 1]!.when({ ...base })).toBe(true);
  });
});

describe("severity derivation", () => {
  const ex = (over: Partial<ExtractionResult> = {}): ExtractionResult => ({
    assetMentions: [], symptomCodes: ["NOT_HEATING"], safetyIndicators: [],
    severityHint: null, severityEvidenceSpan: null, reportedDowntime: false,
    cExtract: 1, usedLexiconFallback: false, ...over,
  });

  it("forces CRITICAL on a critical hazard regardless of the reported tone", () => {
    expect(deriveSeverity(ex({ safetyIndicators: ["GAS_SMELL"], severityHint: "LOW" }))).toBe("CRITICAL");
  });
  it("honours an evidenced hint otherwise", () => {
    expect(deriveSeverity(ex({ severityHint: "HIGH" }))).toBe("HIGH");
  });
  it("raises a non-critical hazard to at least HIGH", () => {
    expect(deriveSeverity(ex({ safetyIndicators: ["SLIP_HAZARD"] }))).toBe("HIGH");
  });
  it("treats an empty report as LOW", () => {
    expect(deriveSeverity(ex({ symptomCodes: [] }))).toBe("LOW");
  });
});
