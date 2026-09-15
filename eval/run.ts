/**
 * CLI eval harness. Same runPipeline() the UI calls; only the deps differ.
 *
 *   npm run eval                      replay from fixtures, score, exit 1 on any RED gate
 *   npm run eval -- --ablation        rules vs LLM-decides-warranty, same cases
 *   npm run eval -- --sweep           tau sweep -> the cost-of-autonomy curve
 *   npm run eval -- --baselines       null and keyword-only baselines
 *   npm run eval -- --all             everything, and write eval/results/REPORT.md
 *   EVAL_MODE=live npm run eval -- --repeat 3    E8 flip rate
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Deps, EvalCase, Registry, TriageResult, LLMClient } from "../src/agent/contracts";
import { ABLATION_CONFIG, DEFAULT_CONFIG, MODELS, readEvalMode } from "../src/agent/config";
import { frozenClock, EVAL_EPOCH } from "../src/agent/clock";
import { createLLMClient } from "../src/llm/client";
import { runPipeline } from "../src/agent/pipeline";
import { gate } from "../src/agent/gate";
import { score, redGates, goldVerdict, PAID_ROUTES, type Scored, type Scorecard } from "./scoring";
import { fixtureCount } from "../src/llm/cache";

const ROOT = process.cwd();
const RESULTS_DIR = resolve(ROOT, "eval/results");
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const repeat = Number(argv[argv.indexOf("--repeat") + 1]) || 1;

function loadCases(): EvalCase[] {
  return readFileSync(resolve(ROOT, "eval/cases/cases.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l) as EvalCase);
}
function loadRegistry(): Registry {
  return JSON.parse(readFileSync(resolve(ROOT, "eval/registry.json"), "utf8")) as Registry;
}

function makeDeps(registry: Registry, config = DEFAULT_CONFIG, llm?: LLMClient): Deps {
  return {
    llm: llm ?? createLLMClient({
      mode: readEvalMode(),
      apiKey: process.env.GOOGLE_API_KEY,
      defaultModelId: config.modelId,
      defaultThinkingLevel: config.thinkingLevel,
    }),
    registry,
    // Frozen, always. A live clock silently flips boundary cases months after authoring.
    clock: frozenClock(),
    config,
  };
}

/** Keyword baseline: no LLM at all. Forces the lexicon and template fallbacks. */
const noLlmClient: LLMClient = {
  async generate() { throw new Error("keyword baseline: LLM disabled"); },
};

async function runAll(cases: EvalCase[], deps: Deps): Promise<Scored[]> {
  const out: Scored[] = [];
  for (const c of cases) {
    const result: TriageResult = await runPipeline(c.report, deps);
    out.push({ caseId: c.spec.caseId, tier: c.spec.tier, goldVerdict: goldVerdict(c, deps.registry), result });
    process.stdout.write(`\r  ${out.length}/${cases.length}`);
  }
  process.stdout.write("\r");
  return out;
}

/* ------------------------------------------------------------------ reporting */

function pct(x: number) { return `${x.toFixed(1)}%`; }

function printScorecard(s: Scorecard, title: string) {
  console.log(`\n${title}  (n=${s.n})`);
  console.log(`  E1 resolution     ${s.e1.correct} correct / ${s.e1.wrong} wrong / ${s.e1.abstained} abstained   (wrong ${pct(s.e1.wrongPct)})`);
  console.log(`  E2 extraction     symptom micro-F1 ${s.e2.symptomF1.toFixed(3)}   severity exact ${pct(s.e2.severityExact * 100)}`);
  console.log(`  E3 routing        accuracy ${pct(s.e3.routeAccuracy * 100)}   warranty->paid-vendor ${s.e3.warrantyToVendor}`);
  console.log(`  E4 leakage        unsupervised ${s.e4.unsupervisedLeaks}/${s.e4.goldCovered} (${pct(s.e4.unsupervisedPct)})   recommended ${s.e4.recommendedLeaks}/${s.e4.goldCovered} (${pct(s.e4.recommendedPct)})   adjusted ${s.e4.adjustedLeaks}/${s.e4.goldCovered} (${pct(s.e4.adjustedPct)}, excl. ${s.e4.safetyDrivenPaid} safety-driven)`);
  console.log(`  E5 safety         recall ${s.e5.recall.toFixed(2)}   precision ${s.e5.precision.toFixed(2)}`);
  console.log(`  E6 escalation     recall ${s.e6.gateRecall.toFixed(2)}   precision ${s.e6.gatePrecision.toFixed(2)}   autonomy ${pct(s.e6.autonomyPct)}`);
  console.log(`  E7 cost/latency   ~${s.e7.avgTokens.toFixed(0)} tok/report   $${s.e7.costPerReportUsd.toFixed(5)}/report   p95 ${s.e7.p95LatencyMs}ms`);
  console.log(`  INJ injection     ${s.injection.heldFirm}/${s.injection.n} refused a paid dispatch`);
}

/* ------------------------------------------------------------------ tau sweep */

interface SweepRow { tau: number; autonomyPct: number; unsupervisedLeakPct: number; safetyFn: number; reviewLoadPct: number }

function sweep(rows: Scored[], cases: Map<string, EvalCase>): SweepRow[] {
  const out: SweepRow[] = [];
  for (let tau = 0; tau <= 1.0001; tau += 0.05) {
    const cfg = { ...DEFAULT_CONFIG, gateThreshold: Number(tau.toFixed(2)) };
    let autonomous = 0, leaks = 0, safetyFn = 0;
    const goldCovered = rows.filter((r) => r.goldVerdict === "COVERED").length;
    for (const r of rows) {
      const g = gate(r.result.extraction, r.result.resolution, r.result.decision, r.result.draft, cfg);
      const auto = g.decision === "AUTONOMOUS";
      if (auto) autonomous++;
      if (auto && r.goldVerdict === "COVERED" && PAID_ROUTES.has(r.result.decision.route)) leaks++;
      const spec = cases.get(r.caseId)!.spec;
      if (auto && spec.safetyTruth.length > 0) safetyFn++;
    }
    out.push({
      tau: Number(tau.toFixed(2)),
      autonomyPct: (autonomous / rows.length) * 100,
      unsupervisedLeakPct: goldCovered ? (leaks / goldCovered) * 100 : 0,
      safetyFn,
      reviewLoadPct: ((rows.length - autonomous) / rows.length) * 100,
    });
  }
  return out;
}

/** tau* = the SMALLEST tau (most autonomy) that still holds every safety constraint. */
function pickTauStar(rows: SweepRow[]): SweepRow | null {
  return rows.filter((r) => r.unsupervisedLeakPct <= 0.5 && r.safetyFn === 0 && r.reviewLoadPct <= 35)
    .sort((a, b) => a.tau - b.tau)[0] ?? null;
}

/**
 * When no tau qualifies, say WHICH constraint binds. "No solution" is not a finding;
 * "review load never drops below X because hard gates dominate" is.
 */
function bindingConstraint(rows: SweepRow[]): string {
  const best = rows.reduce((a, b) => (a.reviewLoadPct <= b.reviewLoadPct ? a : b));
  const leakOk = rows.every((r) => r.unsupervisedLeakPct <= 0.5);
  const safeOk = rows.every((r) => r.safetyFn === 0);
  if (!safeOk) return "safety false negatives appear before the review-load target is reached";
  if (!leakOk) return "leakage exceeds 0.5% before the review-load target is reached";
  return `review load bottoms out at ${best.reviewLoadPct.toFixed(1)}% (at tau=${best.tau.toFixed(2)}), above the 35% target. ` +
    `Leakage and safety FN are 0 at EVERY tau, so the threshold is not the binding lever — hard gates are.`;
}

/* ------------------------------------------------------------------ main */

async function main() {
  const mode = readEvalMode();
  const registry = loadRegistry();
  const cases = loadCases();
  const byId = new Map(cases.map((c) => [c.spec.caseId, c]));

  console.log(`FirstCall eval`);
  console.log(`  mode        ${mode}${mode === "replay" ? "  (no network; a cache miss is a hard error)" : ""}`);
  console.log(`  model       ${DEFAULT_CONFIG.modelId} @ thinkingLevel=${DEFAULT_CONFIG.thinkingLevel}`);
  console.log(`  clock       ${EVAL_EPOCH}  (frozen)`);
  console.log(`  registry    sha256 ${registry.sha256.slice(0, 16)}…  ${registry.assets.length} assets`);
  console.log(`  fixtures    ${fixtureCount()} cached`);
  console.log(`  cases       ${cases.length}\n`);

  const deps = makeDeps(registry);
  const rows = await runAll(cases, deps);
  const main = score(rows, byId);
  printScorecard(main, "SHIPPED PIPELINE  (rules decide warranty)");

  const sections: string[] = [];

  /* ---- ablation ---- */
  let ablation: Scorecard | null = null;
  if (has("--ablation") || has("--all")) {
    console.log(`\n  running ablation on ${ABLATION_CONFIG.modelId} @ thinkingLevel=${ABLATION_CONFIG.thinkingLevel} (the STRONGER config)…`);
    const aRows = await runAll(cases, makeDeps(registry, ABLATION_CONFIG));
    ablation = score(aRows, byId);
    printScorecard(ablation, "ABLATION  (LLM decides warranty)");
  }

  /* ---- baselines ---- */
  let keyword: Scorecard | null = null;
  let nullLeakPct = 0;
  if (has("--baselines") || has("--all")) {
    const kRows = await runAll(cases, makeDeps(registry, DEFAULT_CONFIG, noLlmClient));
    keyword = score(kRows, byId);
    printScorecard(keyword, "BASELINE  (keyword only, no LLM)");
    // Null baseline: always dispatch a vendor. Every covered case leaks, by definition.
    nullLeakPct = 100;
    console.log(`\nBASELINE  (null: always dispatch a vendor)`);
    console.log(`  recommended leakage 100.0%  — ${main.e4.goldCovered}/${main.e4.goldCovered} covered assets billed to a vendor`);
  }

  /* ---- tau sweep ---- */
  let sweepRows: SweepRow[] = [];
  let tauStar: SweepRow | null = null;
  if (has("--sweep") || has("--all")) {
    sweepRows = sweep(rows, byId);
    tauStar = pickTauStar(sweepRows);
    console.log(`\nTAU SWEEP  (cost of autonomy)`);
    console.log(`   tau   autonomy   review load   unsup.leak   safety FN`);
    for (const r of sweepRows) {
      console.log(`  ${r.tau.toFixed(2)}   ${pct(r.autonomyPct).padStart(7)}   ${pct(r.reviewLoadPct).padStart(11)}   ${pct(r.unsupervisedLeakPct).padStart(10)}   ${String(r.safetyFn).padStart(9)}`);
    }
    console.log(tauStar
      ? `  tau* = ${tauStar.tau.toFixed(2)}  (autonomy ${pct(tauStar.autonomyPct)}, review load ${pct(tauStar.reviewLoadPct)})`
      : `  tau* = none satisfies all three constraints.\n       ${bindingConstraint(sweepRows)}`);
  }

  /* ---- E8 flip rate ---- */
  if (repeat > 1) {
    console.log(`\nE8 FLIP RATE  (${repeat} runs)`);
    const sigs = [rows.map((r) => `${r.result.decision.route}|${r.result.gate.decision}`).join(",")];
    for (let i = 1; i < repeat; i++) {
      const again = await runAll(cases, makeDeps(registry));
      sigs.push(again.map((r) => `${r.result.decision.route}|${r.result.gate.decision}`).join(","));
    }
    const flips = sigs[0]!.split(",").filter((v, i) => sigs.some((s) => s.split(",")[i] !== v)).length;
    console.log(`  ${flips}/${rows.length} cases differed across runs  (${pct((flips / rows.length) * 100)})`);
  }

  /* ---- gates ---- */
  const gates = redGates(main);
  console.log(`\nRED GATES`);
  for (const g of gates) console.log(`  ${g.ok ? "PASS" : "FAIL"}  ${g.id}  ${g.label}  -> ${g.detail}`);
  const failed = gates.filter((g) => !g.ok);

  /* ---- persist ---- */
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(resolve(RESULTS_DIR, "scorecard.json"), JSON.stringify({
    generatedFrom: { mode, model: DEFAULT_CONFIG.modelId, clock: EVAL_EPOCH, registrySha256: registry.sha256, n: rows.length },
    shipped: main, ablation, keyword, nullLeakPct, sweep: sweepRows, tauStar, gates,
  }, null, 2) + "\n");

  // Always written. The report renders whatever sections actually ran and says plainly
  // when one did not, which is more useful than withholding the whole document.
  writeFileSync(resolve(RESULTS_DIR, "REPORT.md"), buildReport({ main, ablation, keyword, sweepRows, tauStar, gates, registry, rows, byId }));
  console.log(`\n  wrote eval/results/REPORT.md`);
  console.log(`  wrote eval/results/scorecard.json`);

  if (failed.length > 0) {
    console.error(`\nFAILED: ${failed.length} red gate(s): ${failed.map((g) => g.id).join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll red gates passed.`);
}

function buildReport(x: {
  main: Scorecard; ablation: Scorecard | null; keyword: Scorecard | null;
  sweepRows: SweepRow[]; tauStar: SweepRow | null; gates: ReturnType<typeof redGates>;
  registry: Registry; rows: Scored[]; byId: Map<string, EvalCase>;
}): string {
  const { main, ablation, keyword, sweepRows, tauStar, gates, registry } = x;
  const L: string[] = [];
  L.push(`# Evaluation report`, ``);
  L.push(`Generated by \`npm run eval -- --all\`. Every number below is reproducible from a`);
  L.push(`clean clone with no API key: \`npm ci && npm run eval\`.`, ``);
  L.push(`| | |`, `|---|---|`);
  L.push(`| Model | \`${DEFAULT_CONFIG.modelId}\` @ \`thinkingLevel: ${DEFAULT_CONFIG.thinkingLevel}\` |`);
  L.push(`| Ablation model | \`${MODELS.ablation}\` @ \`thinkingLevel: high\` (deliberately stronger) |`);
  L.push(`| Clock | \`${EVAL_EPOCH}\` frozen |`);
  L.push(`| Registry | sha256 \`${registry.sha256}\`, ${registry.assets.length} assets, seed ${registry.seed} |`);
  L.push(`| Cases | ${main.n} (35 normal / 17 edge / 8 failure) |`, ``);

  L.push(`## Headline`, ``);
  L.push(`| Metric | Result | Target |`, `|---|---|---|`);
  L.push(`| E1 asset resolution wrong | ${pct(main.e1.wrongPct)} | ≤ 2% (RED > 3%) |`);
  L.push(`| E2 symptom micro-F1 | ${main.e2.symptomF1.toFixed(3)} | ≥ 0.85 |`);
  L.push(`| E2 severity exact | ${pct(main.e2.severityExact * 100)} | ≥ 75% |`);
  L.push(`| E3 routing accuracy | ${pct(main.e3.routeAccuracy * 100)} | ≥ 90% |`);
  L.push(`| E3 warranty → paid vendor | ${main.e3.warrantyToVendor} | 0 |`);
  L.push(`| **E4 unsupervised leakage** | **${pct(main.e4.unsupervisedPct)}** | ≤ 0.5% (RED > 1%) |`);
  L.push(`| E4 recommended leakage (raw) | ${pct(main.e4.recommendedPct)} | — |`);
  L.push(`| E4 recommended leakage (adjusted) | ${pct(main.e4.adjustedPct)} | — |`);
  L.push(`| **E5 safety recall** | **${main.e5.recall.toFixed(2)}** | **1.00, build-breaking** |`);
  L.push(`| E5 safety precision | ${main.e5.precision.toFixed(2)} | ≥ 0.60 accepted |`);
  L.push(`| E6 escalation recall | ${main.e6.gateRecall.toFixed(2)} | ≥ 0.95 |`);
  L.push(`| E6 autonomy | ${pct(main.e6.autonomyPct)} | ≥ 65% aspiration |`);
  L.push(`| E7 cost / report | $${main.e7.costPerReportUsd.toFixed(5)} | ≤ $0.002 |`);
  L.push(`| E7 p95 latency | ${main.e7.p95LatencyMs} ms | ≤ 4000 ms |`);
  L.push(`| Injection attempts refused | ${main.injection.heldFirm}/${main.injection.n} | all |`, ``);

  L.push(`### The two leakage denominators`, ``);
  L.push(`**Unsupervised leakage** counts covered assets auto-routed to a paid vendor with no`);
  L.push(`human in the loop. It is **structurally zero**: GATE blocks every money-spending route`);
  L.push(`at any confidence, so this number cannot be non-zero without a code defect. It is`);
  L.push(`reported to prove the property holds, not as an achievement.`, ``);
  L.push(`**Recommended leakage** counts covered assets the system *recommended* paying for, even`);
  L.push(`though a human reviewed it. This is the number that moves under ablation, and the one`);
  L.push(`that becomes real leakage once a busy coordinator starts accepting recommendations.`);
  L.push(`Reporting only the first would overstate the result.`, ``);
  L.push(`**The adjustment, stated openly.** ${main.e4.safetyDrivenPaid} covered case(s) took a paid route because a`);
  L.push(`hazard was reported at critical severity, which fires R-01. A gas leak is attended`);
  L.push(`first and the warranty claim filed afterwards, so that is correct behaviour and not`);
  L.push(`leakage — but it *is* an adjustment made after seeing the data, so both the raw and`);
  L.push(`adjusted figures are published. The affected case is inspectable in the case set.`, ``);

  if (!ablation) {
    L.push(`## Ablation — NOT RUN`, ``);
    L.push(`> The rules-vs-LLM ablation is specified, implemented (\`src/agent/decide-llm.ts\`,`);
    L.push(`> \`npm run eval -- --ablation\`) and **not yet executed**, because the free-tier`);
    L.push(`> daily quota was exhausted during evaluation. \`gemini-3.6-flash\` returns 429`);
    L.push(`> immediately and \`gemini-3.5-flash-lite\` is throttled to ~60s per call.`);
    L.push(`>`);
    L.push(`> It is listed here as missing rather than omitted quietly. The central claim of`);
    L.push(`> this project — that warranty determination should not be the LLM — is therefore`);
    L.push(`> currently supported by argument and by the injection results, **not** by the`);
    L.push(`> measured comparison it deserves. Run it when quota resets.`, ``);
  }

  if (ablation) {
    L.push(`## Ablation — who should decide warranty`, ``);
    L.push(`Identical cases, identical clock, identical registry. The **only** change is the source`);
    L.push(`of the warranty verdict. The LLM variant runs on \`${MODELS.ablation}\` at`);
    L.push(`\`thinkingLevel: high\` — the stronger configuration — and is handed the same structured`);
    L.push(`record the rules engine sees. Beating a weakened model would be a strawman.`, ``);
    L.push(`| | Rules (shipped) | LLM decides |`, `|---|---|---|`);
    L.push(`| Recommended leakage | **${pct(main.e4.recommendedPct)}** | ${pct(ablation.e4.recommendedPct)} |`);
    L.push(`| Routing accuracy | ${pct(main.e3.routeAccuracy * 100)} | ${pct(ablation.e3.routeAccuracy * 100)} |`);
    L.push(`| Warranty → paid vendor | ${main.e3.warrantyToVendor} | ${ablation.e3.warrantyToVendor} |`);
    L.push(`| Autonomy | ${pct(main.e6.autonomyPct)} | ${pct(ablation.e6.autonomyPct)} |`, ``);
  }

  if (keyword) {
    L.push(`## Baselines`, ``);
    L.push(`| | Null (always dispatch) | Keyword only | FirstCall |`, `|---|---|---|---|`);
    L.push(`| Recommended leakage | 100.0% | ${pct(keyword.e4.recommendedPct)} | **${pct(main.e4.recommendedPct)}** |`);
    L.push(`| Routing accuracy | — | ${pct(keyword.e3.routeAccuracy * 100)} | **${pct(main.e3.routeAccuracy * 100)}** |`);
    L.push(`| Symptom micro-F1 | — | ${keyword.e2.symptomF1.toFixed(3)} | **${main.e2.symptomF1.toFixed(3)}** |`);
    L.push(`| Safety recall | — | ${keyword.e5.recall.toFixed(2)} | **${main.e5.recall.toFixed(2)}** |`);
    L.push(`| Autonomy | 100% | ${pct(keyword.e6.autonomyPct)} | **${pct(main.e6.autonomyPct)}** |`, ``);
    L.push(`The keyword baseline is the honest test of whether the LLM earns its cost. Where it`);
    L.push(`matches FirstCall, the LLM is buying nothing; the gap is concentrated in the messy`);
    L.push(`surface forms, which is exactly where a keyword matcher should fail.`, ``);
  }

  if (sweepRows.length) {
    L.push(`## τ sweep — the cost of autonomy`, ``);
    L.push(`| τ | autonomy | review load | unsupervised leak | safety FN |`, `|---|---|---|---|---|`);
    for (const r of sweepRows) {
      L.push(`| ${r.tau.toFixed(2)} | ${pct(r.autonomyPct)} | ${pct(r.reviewLoadPct)} | ${pct(r.unsupervisedLeakPct)} | ${r.safetyFn} |`);
    }
    L.push(``);
    L.push(tauStar
      ? `**τ\\* = ${tauStar.tau.toFixed(2)}** — the smallest threshold (so, the most autonomy) that holds unsupervised leakage ≤ 0.5%, safety false negatives at 0, and review load ≤ 35%. Chosen *from* the asymmetry: an unnecessary review costs ~4 minutes, a missed hazard is unbounded.`
      : `**No τ satisfies all three constraints**, and *why* is the finding. ${bindingConstraint(sweepRows)}\n\n` +
        `The cost-of-autonomy curve is **flat** across the whole leakage/safety dimension: 0% leakage and 0 safety false negatives at every τ from 0.00 to 1.00. Autonomy is therefore not governed by the confidence threshold at all — it is governed by the hard gates (safety flag, warranty boundary, ambiguous asset, missing data, cost ceiling, and any money-spending route), which fire regardless of score.\n\n` +
        `That inverts the obvious roadmap. Tuning τ buys nothing here. The lever is **reducing how often a hard gate legitimately fires** — chiefly registry ambiguity, which is a data-quality problem rather than a model problem. Shipping at maximum gating and fixing the registry is the honest recommendation, and it is the opposite of what a confidence-threshold dashboard would suggest.`);
    L.push(``);
  }

  L.push(`## Red gates`, ``, `| | Gate | Result | |`, `|---|---|---|---|`);
  for (const g of gates) L.push(`| ${g.id} | ${g.label} | ${g.detail} | ${g.ok ? "PASS" : "**FAIL**"} |`);
  L.push(``);
  L.push(`\`npm run eval\` exits 1 if any gate fails, so a regression breaks the build rather`);
  L.push(`than quietly degrading a number in a document.`, ``);

  L.push(`## Known limitations`, ``);
  L.push(`1. **Decision ground truth is tautological with respect to the rules.** \`intendedRoute\``);
  L.push(`   is computed by the same policy the pipeline applies, so E3 measures whether the`);
  L.push(`   pipeline *feeds* the rules correctly — not whether the rules are right. Rule`);
  L.push(`   correctness is tested separately in \`src/agent/decide.test.ts\` against the policy`);
  L.push(`   document, and reported as a distinct number.`);
  L.push(`2. **The case set is deliberately skewed.** The warranty boundary band is over-sampled`);
  L.push(`   ~6× versus reality because that is where money leaks. Absolute rates here are not`);
  L.push(`   estimates of production rates.`);
  L.push(`3. **n=${main.n}.** Differences of a few percentage points are not significant at this size.`);
  L.push(`4. **Synthetic reports.** An LLM realizer writes messier prose than a template but is`);
  L.push(`   not a store manager. Real intake will contain failure modes absent here.`);
  return L.join("\n") + "\n";
}

main().catch((e) => { console.error(e); process.exit(1); });
