import type { PipelineConfig } from "./contracts";

/**
 * Model pinning is empirical, not documentary.
 *
 * `GET /v1beta/models` advertises 41 models including the whole 2.5 family, but a new
 * free-tier key gets `404 ... no longer available to new users` on most of them. Only
 * models that have actually returned 200 against this key are listed here.
 *
 * thinkingLevel "low" is deliberate: default thinking spent 521 thought tokens on a
 * 16-token prompt (~20x amplification) and produced the same extraction. EXTRACT is
 * span-grounded classification against a closed vocabulary; it does not need reasoning.
 */
export const MODELS = {
  /** Shipped path. Measured: 0 thought tokens, 71 total, 1.2s. */
  primary: "gemini-3.5-flash-lite",
  /**
   * Ablation only — the LLM-decides-warranty variant runs on the STRONGEST config so that
   * beating it is evidence rather than a strawman.
   *
   * `gemini-3.6-flash` is the PREFERRED opponent and carries its own per-model daily
   * free-tier quota, which this evaluation exhausted (429 on every request). The committed
   * fixtures were therefore recorded against `gemini-3.5-flash-lite` at thinkingLevel
   * "high" — still thinking-enabled and still stronger than the shipped config, but weaker
   * than intended, which flatters the rules and is declared in the report.
   *
   * The default matches what is RECORDED, not what is preferred, so that
   * `npm run eval -- --ablation` reproduces offline on a clean clone. To re-run against the
   * stronger opponent once quota resets:
   *
   *   ABLATION_MODEL=gemini-3.6-flash EVAL_MODE=record npm run eval -- --ablation
   */
  ablation: process.env.ABLATION_MODEL ?? "gemini-3.5-flash-lite",
} as const;

export const DEFAULT_CONFIG: PipelineConfig = {
  // Provisional. Replaced by tau* from the Day 4 sweep; the sweep is the justification.
  gateThreshold: 0.75,
  costGateUsd: 2500,
  warrantyBoundaryDays: 30,
  modelId: MODELS.primary,
  thinkingLevel: "low",
  useRulesForWarranty: true,
};

/** The ablation config. Same cases, same clock, stronger model, rules removed. */
export const ABLATION_CONFIG: PipelineConfig = {
  ...DEFAULT_CONFIG,
  modelId: MODELS.ablation,
  thinkingLevel: "high",
  useRulesForWarranty: false,
};

export type EvalMode = "replay" | "record" | "live";

export function readEvalMode(env: NodeJS.ProcessEnv = process.env): EvalMode {
  const raw = (env.EVAL_MODE ?? "replay").toLowerCase();
  if (raw === "replay" || raw === "record" || raw === "live") return raw;
  throw new Error(`EVAL_MODE must be replay | record | live, got "${raw}"`);
}
