import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Deps, Registry, TriageResult } from "@/src/agent/contracts";
import { DEFAULT_CONFIG, readEvalMode } from "@/src/agent/config";
import { frozenClock } from "@/src/agent/clock";
import { createLLMClient } from "@/src/llm/client";

let cached: Registry | null = null;
function registry(): Registry {
  cached ??= JSON.parse(readFileSync(resolve(process.cwd(), "eval/registry.json"), "utf8")) as Registry;
  return cached;
}

/**
 * The web deps. Same shape the CLI harness builds, so both call an identical
 * runPipeline() — that equivalence is the reproducibility claim and is load-bearing.
 *
 * Defaults to replay so a deployment with no API key still demonstrates every recorded
 * report. Custom text will miss the cache and say so plainly, which is a more honest
 * demo than silently degrading.
 */
export function webDeps(): Deps {
  return {
    llm: createLLMClient({
      mode: readEvalMode(),
      apiKey: process.env.GOOGLE_API_KEY,
      defaultModelId: DEFAULT_CONFIG.modelId,
      defaultThinkingLevel: DEFAULT_CONFIG.thinkingLevel,
    }),
    registry: registry(),
    clock: frozenClock(),
    config: DEFAULT_CONFIG,
  };
}

/**
 * In-memory result store. Deliberately not a database: nothing in a 40-hour sprint
 * justifies one, and pretending otherwise in a demo would be the easiest lie to tell.
 * Results are lost on restart.
 */
const results = new Map<string, TriageResult>();
export function putResult(r: TriageResult) { results.set(r.reportId, r); }
export function getResult(id: string) { return results.get(id) ?? null; }

export interface SampleReport { reportId: string; storeId: string; text: string; label: string }

let samples: SampleReport[] | null = null;
export function sampleReports(): SampleReport[] {
  if (samples) return samples;
  const lines = readFileSync(resolve(process.cwd(), "eval/cases/cases.jsonl"), "utf8").trim().split("\n");
  samples = lines.map((l) => {
    const c = JSON.parse(l);
    return { reportId: c.spec.caseId, storeId: c.report.storeId, text: c.report.text, label: `${c.spec.tier} · ${c.spec.surfaceStyle}` };
  });
  return samples;
}
