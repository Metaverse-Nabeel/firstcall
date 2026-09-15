/**
 * FirstCall — the single source of truth for every contract crossing a stage boundary.
 *
 * Two rules govern this file, and both exist to prevent warranty leakage:
 *
 *  1. The LLM never emits an `assetId`. It emits descriptors. Resolution is deterministic.
 *  2. Missing data is typed UNKNOWN and propagates. It is never defaulted, because a
 *     defaulted join is how a covered asset gets billed to a vendor.
 *
 * See AGENT.md for the reasoning behind each boundary.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ vocabularies */

/** Closed vocabulary. The LLM may only choose from these — an unlisted value fails the schema. */
export const AssetType = z.enum([
  "FRYER", "GRILL", "WALK_IN_COOLER", "REACH_IN_FREEZER", "ICE_MACHINE",
  "HVAC_RTU", "DISHWASHER", "COFFEE_BREWER", "HOOD_EXHAUST", "WATER_HEATER",
  "PREP_TABLE", "POS_TERMINAL", "UNKNOWN_TYPE",
]);
export type AssetType = z.infer<typeof AssetType>;

export const SymptomCode = z.enum([
  "NO_POWER", "BREAKER_TRIP", "OVERHEATING", "NOT_COOLING", "NOT_HEATING",
  "LEAKING_WATER", "LEAKING_REFRIGERANT", "BURNING_SMELL", "SMOKE", "GAS_ODOR",
  "UNUSUAL_NOISE", "DOOR_SEAL_FAIL", "CONTROL_BOARD_ERROR", "THERMOSTAT_DRIFT",
  "CLOGGED_DRAIN", "ICE_BUILDUP", "VIBRATION", "DISPLAY_ERROR",
  "INTERMITTENT_OPERATION", "COMPLETE_FAILURE",
]);
export type SymptomCode = z.infer<typeof SymptomCode>;

/**
 * Safety indicators are recall-first by construction: the gate fires on ANY of these,
 * from either the LLM or the deterministic lexicon. Precision >= 0.60 is accepted, and
 * the cost of that choice is published (E5) rather than tuned away.
 */
export const SafetyIndicator = z.enum([
  "GAS_SMELL", "ELECTRICAL_ARCING", "SMOKE_OR_FIRE", "BURN_HAZARD",
  "EXPOSED_WIRING", "CO_ALARM", "SLIP_HAZARD", "STRUCTURAL_HAZARD",
  "FOOD_SAFETY_TEMP_BREACH",
]);
export type SafetyIndicator = z.infer<typeof SafetyIndicator>;

export const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type Severity = z.infer<typeof Severity>;

export const Route = z.enum([
  "NO_ACTION",          // reported issue needs no work order
  "IN_HOUSE_FIX",       // store-level action, no cost
  "WARRANTY_CLAIM",     // manufacturer pays
  "VENDOR_DISPATCH",    // we pay  <- the expensive side; never autonomous
  "EMERGENCY_DISPATCH", // we pay, expedited
  "ESCALATE_HUMAN",     // the cheap-to-be-wrong side
]);
export type Route = z.infer<typeof Route>;

export const WarrantyVerdict = z.enum([
  "COVERED",
  "NOT_COVERED",
  "EXPIRED",
  "VOIDED_NO_PM",         // coverage forfeited: preventive-maintenance log incomplete
  "BOUNDARY_REVIEW",      // failure date within +/-30d of expiry — always gated
  "UNKNOWN_MISSING_DATA", // a required field was UNKNOWN. Never guessed.
]);
export type WarrantyVerdict = z.infer<typeof WarrantyVerdict>;

/* ------------------------------------------------------------------ registry */

export const Asset = z.object({
  assetId: z.string(),
  storeId: z.string(),
  assetTag: z.string(),          // what a manager would read off the sticker, e.g. "FRY-02"
  type: AssetType,
  manufacturer: z.string(),
  model: z.string(),
  serial: z.string(),
  /** Ordinal within its class at this store. This is what creates genuine ambiguity. */
  ordinal: z.number().int().positive(),
  location: z.string(),          // "front line", "back prep", "roof"
  inServiceDate: z.string(),     // ISO date
  warrantyTermMonths: z.number().int().nonnegative(),
  /** Coverage is void without a complete PM log. Null means the log itself is missing. */
  pmLogComplete: z.boolean().nullable(),
  replacementCost: z.number().nonnegative(),
  typicalRepairCost: z.number().nonnegative(),
});
export type Asset = z.infer<typeof Asset>;

export const Vendor = z.object({
  vendorId: z.string(),
  name: z.string(),
  coversTypes: z.array(AssetType),
  coversStores: z.array(z.string()),
  slaHoursStandard: z.number().positive(),
  slaHoursEmergency: z.number().positive(),
  callOutFee: z.number().nonnegative(),
  hourlyRate: z.number().nonnegative(),
});
export type Vendor = z.infer<typeof Vendor>;

export const Registry = z.object({
  seed: z.number().int(),
  sha256: z.string(),            // printed in every eval report
  assets: z.array(Asset),
  vendors: z.array(Vendor),
});
export type Registry = z.infer<typeof Registry>;

/* ------------------------------------------------------------------ input */

export const BreakdownReport = z.object({
  reportId: z.string(),
  storeId: z.string(),
  reportedAt: z.string(),        // ISO datetime
  reporterRole: z.enum(["STORE_MANAGER", "SHIFT_LEAD", "AREA_MANAGER"]),
  /** Free text, exactly as the manager typed it. Untrusted input. */
  text: z.string(),
});
export type BreakdownReport = z.infer<typeof BreakdownReport>;

/* ------------------------------------------------------------------ 1. EXTRACT */

/**
 * A descriptor, NOT an identifier.
 *
 * The LLM controls this object and an attacker controls the report text, so an attacker
 * transitively controls this object. That is acceptable precisely because nothing here
 * names an asset — RETRIEVE must independently confirm every mention against the registry.
 * This is what makes prompt injection structurally uninteresting rather than a patch target.
 */
export const AssetMention = z.object({
  surfaceText: z.string(),                  // verbatim span from the report
  type: AssetType,
  ordinalHint: z.number().int().nullable(), // "fryer 2" -> 2
  locationHint: z.string().nullable(),
  modelHint: z.string().nullable(),
});
export type AssetMention = z.infer<typeof AssetMention>;

export const ExtractionResult = z.object({
  assetMentions: z.array(AssetMention),
  symptomCodes: z.array(SymptomCode),
  safetyIndicators: z.array(SafetyIndicator),
  severityHint: Severity.nullable(),
  /** A severity with no supporting span is dropped. Claims must cite their evidence. */
  severityEvidenceSpan: z.string().nullable(),
  reportedDowntime: z.boolean(),
  /** Set by the pipeline, never by the model: agreement between LLM and lexicon extractors. */
  cExtract: z.number().min(0).max(1),
  /** True when the schema failed twice and the deterministic lexicon carried the stage. */
  usedLexiconFallback: z.boolean(),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/** Exactly what is sent to the model. Deliberately omits cExtract and the fallback flag. */
export const ExtractionLLMOutput = ExtractionResult.omit({
  cExtract: true,
  usedLexiconFallback: true,
});
export type ExtractionLLMOutput = z.infer<typeof ExtractionLLMOutput>;

/* ------------------------------------------------------------------ 2. RETRIEVE */

export const AssetCandidate = z.object({
  assetId: z.string(),
  assetTag: z.string(),
  score: z.number(),
  matchedOn: z.array(z.enum(["TAG", "TYPE", "ORDINAL", "MODEL", "LOCATION"])),
});
export type AssetCandidate = z.infer<typeof AssetCandidate>;

export const ResolutionResult = z.object({
  resolved: Asset.nullable(),
  candidates: z.array(AssetCandidate),      // ranked, surfaced for the one-click pick
  /** Gap between best and second-best. Drives cResolve, and drives the ambiguity gate. */
  topMargin: z.number(),
  ambiguous: z.boolean(),
  notInRegistry: z.boolean(),
  multiAsset: z.boolean(),
  cResolve: z.number().min(0).max(1),
});
export type ResolutionResult = z.infer<typeof ResolutionResult>;

/* ------------------------------------------------------------------ 3. DECIDE */

export const FiredRule = z.object({
  ruleId: z.string(),        // "W-12"
  description: z.string(),
  /** The audit trail a manufacturer will be shown when they dispute the claim. */
  evidence: z.string(),
});
export type FiredRule = z.infer<typeof FiredRule>;

export const DecisionResult = z.object({
  warrantyVerdict: WarrantyVerdict,
  warrantyExpiresOn: z.string().nullable(),
  daysToWarrantyExpiry: z.number().nullable(),
  severity: Severity,
  route: Route,
  costExposure: z.number().nonnegative(),
  assignedVendorId: z.string().nullable(),
  slaDeadline: z.string().nullable(),
  rulesFired: z.array(FiredRule),
  cDecide: z.number().min(0).max(1),
});
export type DecisionResult = z.infer<typeof DecisionResult>;

/* ------------------------------------------------------------------ 4. DRAFT */

/** The only two fields the LLM writes. Everything else is populated from structured data. */
export const DraftLLMOutput = z.object({
  symptomSummary: z.string(),
  vendorInstructions: z.string(),
});
export type DraftLLMOutput = z.infer<typeof DraftLLMOutput>;

export const GroundednessViolation = z.object({
  token: z.string(),
  kind: z.enum(["NUMERAL", "DATE", "AMOUNT", "ASSET_TAG"]),
  field: z.enum(["symptomSummary", "vendorInstructions"]),
});
export type GroundednessViolation = z.infer<typeof GroundednessViolation>;

export const DraftResult = z.object({
  workOrder: z.object({
    workOrderId: z.string(),
    assetTag: z.string(),
    storeId: z.string(),
    severity: Severity,
    route: Route,
    warrantyVerdict: WarrantyVerdict,
    slaDeadline: z.string().nullable(),
    symptomSummary: z.string(),
    vendorInstructions: z.string(),
  }),
  /** True when an ungrounded token forced the template fallback. */
  usedTemplateFallback: z.boolean(),
  groundednessViolations: z.array(GroundednessViolation),
  cDraft: z.number().min(0).max(1),
});
export type DraftResult = z.infer<typeof DraftResult>;

/* ------------------------------------------------------------------ 5. GATE */

export const GateReason = z.enum([
  "SAFETY_FLAG",
  "AMBIGUOUS_ASSET",
  "NOT_IN_REGISTRY",
  "MISSING_DATA",
  "COST_THRESHOLD",
  "MULTI_ASSET",
  "WARRANTY_BOUNDARY",
  "LOW_CONFIDENCE",
  "EXTRACTION_FALLBACK",
]);
export type GateReason = z.infer<typeof GateReason>;

export const GateDecision = z.enum(["AUTONOMOUS", "REVIEW", "ESCALATE"]);
export type GateDecision = z.infer<typeof GateDecision>;

export const GateResult = z.object({
  decision: GateDecision,
  /**
   * min(cExtract, cResolve, cDecide, cDraft).
   *
   * min, not product: it names the weak link, which becomes the "why was this escalated"
   * string directly. A product yields a number nobody can act on.
   */
  confidence: z.number().min(0).max(1),
  weakestLink: z.enum(["EXTRACT", "RETRIEVE", "DECIDE", "DRAFT"]),
  /** Hard gates override the threshold entirely — a high score cannot buy past them. */
  hardGates: z.array(GateReason),
  threshold: z.number(),
  explanation: z.string(),
});
export type GateResult = z.infer<typeof GateResult>;

/* ------------------------------------------------------------------ pipeline */

export const TriageResult = z.object({
  reportId: z.string(),
  extraction: ExtractionResult,
  resolution: ResolutionResult,
  decision: DecisionResult,
  draft: DraftResult,
  gate: GateResult,
  trace: z.object({
    promptVersions: z.record(z.string()),
    modelId: z.string(),
    clockNow: z.string(),
    registrySha256: z.string(),
    llmCalls: z.number().int(),
    cacheHits: z.number().int(),
    latencyMs: z.number(),
  }),
});
export type TriageResult = z.infer<typeof TriageResult>;

/* ------------------------------------------------------------------ eval spec */

/**
 * Ground truth is authored BEFORE any prose exists. The surface realizer is shown the
 * scenario but never these label fields, so extraction and resolution truth come free
 * and independently. See the eval-gates skill.
 */
export const ScenarioSpec = z.object({
  caseId: z.string(),
  tier: z.enum(["NORMAL", "EDGE", "FAILURE"]),
  difficultyNotes: z.string(),
  storeId: z.string(),
  /** Null for the not-in-registry failure cases. */
  assetId: z.string().nullable(),
  warrantyState: z.enum([
    "WELL_INSIDE", "WELL_OUTSIDE", "BOUNDARY_INSIDE", "BOUNDARY_OUTSIDE",
    "NO_PM_LOG", "MISSING_IN_SERVICE_DATE",
  ]),
  faultCodes: z.array(SymptomCode),
  safetyTruth: z.array(SafetyIndicator),
  severityTruth: Severity,
  intendedRoute: Route,
  shouldGate: z.boolean(),
  /** Style directive for the realizer. Never includes any label field above. */
  surfaceStyle: z.enum([
    "PLAIN", "TERSE_SMS", "RAMBLING", "ANGRY", "POLITE",
    "CODE_SWITCH_ES_EN", "TYPO_HEAVY", "HEDGED_SAFETY", "INJECTION_ATTEMPT",
  ]),
});
export type ScenarioSpec = z.infer<typeof ScenarioSpec>;

export const EvalCase = z.object({
  spec: ScenarioSpec,
  report: BreakdownReport,
});
export type EvalCase = z.infer<typeof EvalCase>;

/* ------------------------------------------------------------------ deps */

/**
 * Injected, never `Date.now()`. Warranty math depends on "now"; without a frozen clock
 * the suite drifts and boundary cases silently flip months later. This is the single
 * highest-probability bug in the whole design.
 */
export interface Clock {
  now(): Date;
}

export interface LLMClient {
  /** Structured generation. Throws on schema violation so callers can decide the fallback. */
  generate<T>(args: {
    promptVersion: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    jsonSchema: Record<string, unknown>;
    modelId?: string;
    thinkingLevel?: "low" | "high";
  }): Promise<{ value: T; cached: boolean; latencyMs: number; tokens: number }>;
}

export interface PipelineConfig {
  /** tau — set from the sweep, not guessed. See eval/results/tau-sweep.md. */
  gateThreshold: number;
  costGateUsd: number;
  warrantyBoundaryDays: number;
  modelId: string;
  thinkingLevel: "low" | "high";
  /** When false, DECIDE is swapped for the LLM variant. Powers the ablation. */
  useRulesForWarranty: boolean;
}

export interface Deps {
  llm: LLMClient;
  registry: Registry;
  clock: Clock;
  config: PipelineConfig;
}
