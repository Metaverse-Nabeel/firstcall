/**
 * The pipeline. The UI and the CLI eval harness both call exactly this function and differ
 * only in the `deps` they construct.
 *
 * That is the reproducibility claim, and it is load-bearing: nothing can be demonstrable in
 * the demo that the harness cannot exercise headlessly, so a number in the case study and a
 * screen in the video cannot drift apart.
 */
import type { BreakdownReport, Deps, TriageResult } from "./contracts";
import { extract, EXTRACT_PROMPT_VERSION } from "./extract";
import { retrieve } from "./retrieve";
import { decide, deriveSeverity, computeCostExposure, applyRouting } from "./decide";
import { determineWarrantyViaLLM, DECIDE_LLM_PROMPT_VERSION } from "./decide-llm";
import { draft, DRAFT_PROMPT_VERSION } from "./draft";
import { gate } from "./gate";
import { addHours } from "./dates";

export async function runPipeline(report: BreakdownReport, deps: Deps): Promise<TriageResult> {
  const started = Date.now();
  const callsBefore = callCount(deps);
  const hitsBefore = hitCount(deps);
  const latencyBefore = latencySum(deps);

  const extraction = await extract(report, deps.llm);
  const resolution = retrieve(extraction, report, deps.registry);

  let decision = decide(extraction, resolution, report, deps.registry, deps.config);

  // Ablation path. Everything except the warranty verdict is held constant, so the
  // difference in leakage is attributable to the verdict source and nothing else.
  if (!deps.config.useRulesForWarranty) {
    const llmWarranty = await determineWarrantyViaLLM(
      resolution.resolved, report.reportedAt, extraction.symptomCodes,
      deps.llm, deps.config.modelId, deps.config.thinkingLevel,
    );
    const severity = deriveSeverity(extraction);
    const costExposure = computeCostExposure(resolution.resolved, deps.registry);
    const vendor = resolution.resolved
      ? deps.registry.vendors.find((v) => v.coversTypes.includes(resolution.resolved!.type) && v.coversStores.includes(resolution.resolved!.storeId)) ?? null
      : null;
    const { route, rule } = applyRouting({
      verdict: llmWarranty.verdict, severity,
      hasSafety: extraction.safetyIndicators.length > 0,
      ambiguous: resolution.ambiguous, notInRegistry: resolution.notInRegistry,
      multiAsset: resolution.multiAsset, costExposure, costGate: deps.config.costGateUsd,
      hasVendor: vendor !== null, symptoms: extraction.symptomCodes,
    });
    const needsVendor = route === "VENDOR_DISPATCH" || route === "EMERGENCY_DISPATCH";
    const slaHours = vendor ? (route === "EMERGENCY_DISPATCH" ? vendor.slaHoursEmergency : vendor.slaHoursStandard) : null;
    decision = {
      warrantyVerdict: llmWarranty.verdict,
      warrantyExpiresOn: llmWarranty.expiresOn,
      daysToWarrantyExpiry: llmWarranty.daysToExpiry,
      severity, route, costExposure,
      assignedVendorId: needsVendor && vendor ? vendor.vendorId : null,
      slaDeadline: vendor && slaHours !== null ? addHours(report.reportedAt, slaHours) : null,
      rulesFired: [...llmWarranty.rules, rule],
      cDecide: llmWarranty.verdict === "UNKNOWN_MISSING_DATA" ? 0 : 1,
    };
  }

  const draftResult = await draft(report, extraction, resolution, decision, deps.llm);
  const gateResult = gate(extraction, resolution, decision, draftResult, deps.config);

  return {
    reportId: report.reportId,
    extraction, resolution, decision, draft: draftResult, gate: gateResult,
    trace: {
      promptVersions: {
        extract: EXTRACT_PROMPT_VERSION,
        draft: DRAFT_PROMPT_VERSION,
        ...(deps.config.useRulesForWarranty ? {} : { decideLlm: DECIDE_LLM_PROMPT_VERSION }),
      },
      modelId: deps.config.modelId,
      clockNow: deps.clock.now().toISOString(),
      registrySha256: deps.registry.sha256,
      llmCalls: callCount(deps) - callsBefore,
      modelLatencyMs: latencySum(deps) - latencyBefore,
      cacheHits: hitCount(deps) - hitsBefore,
      latencyMs: Date.now() - started,
    },
  };
}

function callCount(deps: Deps): number {
  return (deps.llm as { stats?: { calls: number } }).stats?.calls ?? 0;
}
function hitCount(deps: Deps): number {
  return (deps.llm as { stats?: { cacheHits: number } }).stats?.cacheHits ?? 0;
}
function latencySum(deps: Deps): number {
  return (deps.llm as { stats?: { latencyMs: number } }).stats?.latencyMs ?? 0;
}
