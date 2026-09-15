/**
 * The LLMClient the pipeline depends on. Mode-aware:
 *
 *   replay (default) — fixtures only. A miss is a HARD ERROR, never a silent API call.
 *   record           — serve from cache, call live on a miss, persist the result.
 *   live             — always call. Used only for the E8 flip-rate measurement.
 *
 * The UI and the eval harness construct different clients but the pipeline cannot tell
 * them apart, which is what keeps "the harness exercises exactly what the UI does" true.
 */
import type { z } from "zod";
import type { LLMClient } from "../agent/contracts";
import type { EvalMode } from "../agent/config";
import { buildGenerationConfig, callGemini } from "./gemini";
import { cacheKey, readFixture, writeFixture, FixtureMissError } from "./cache";

export interface ClientStats {
  calls: number;
  cacheHits: number;
  liveCalls: number;
  tokens: number;
  /** Sum of real model latencies (recorded or live), never replay's ~0. */
  latencyMs: number;
}

export function createLLMClient(opts: {
  mode: EvalMode;
  apiKey?: string | undefined;
  defaultModelId: string;
  defaultThinkingLevel: "low" | "high";
}): LLMClient & { stats: ClientStats } {
  const stats: ClientStats = { calls: 0, cacheHits: 0, liveCalls: 0, tokens: 0, latencyMs: 0 };

  const client: LLMClient & { stats: ClientStats } = {
    stats,
    async generate<T>(args: {
      promptVersion: string;
      system: string;
      user: string;
      schema: z.ZodType<T>;
      jsonSchema: Record<string, unknown>;
      modelId?: string;
      thinkingLevel?: "low" | "high";
    }) {
      const modelId = args.modelId ?? opts.defaultModelId;
      const thinkingLevel = args.thinkingLevel ?? opts.defaultThinkingLevel;
      const generationConfig = buildGenerationConfig(args.jsonSchema, thinkingLevel);
      const key = cacheKey({
        modelId,
        promptVersion: args.promptVersion,
        system: args.system,
        user: args.user,
        generationConfig,
      });

      stats.calls++;

      if (opts.mode !== "live") {
        const hit = readFixture(key);
        if (hit) {
          stats.cacheHits++;
          stats.tokens += hit.tokens;
          stats.latencyMs += hit.latencyMs ?? 0;
          return {
            value: parseOrThrow(args.schema, hit.responseText, args.promptVersion),
            cached: true,
            // The RECORDED latency, not 0. Replay skips the network, so a 0 here would
            // make E7 look spectacular and mean nothing. Older fixtures predate this
            // field and contribute 0, which is visible rather than silently flattering.
            latencyMs: hit.latencyMs ?? 0,
            tokens: hit.tokens,
          };
        }
        if (opts.mode === "replay") throw new FixtureMissError(key, args.promptVersion);
      }

      if (!opts.apiKey) {
        throw new Error(
          `EVAL_MODE=${opts.mode} needs GOOGLE_API_KEY. Copy .env.example to .env.local.\n` +
            `(The default replay mode needs no key and no network.)`,
        );
      }

      const res = await callGemini({
        modelId,
        system: args.system,
        user: args.user,
        jsonSchema: args.jsonSchema,
        thinkingLevel,
        apiKey: opts.apiKey,
      });
      stats.liveCalls++;
      stats.tokens += res.tokens;
      stats.latencyMs += res.latencyMs;

      // Parse BEFORE persisting: a fixture that fails its own schema is a landmine for
      // the next replay run, and the error would surface far from its cause.
      const value = parseOrThrow(args.schema, res.text, args.promptVersion);
      if (opts.mode === "record") {
        writeFixture({
          key,
          modelId,
          promptVersion: args.promptVersion,
          responseText: res.text,
          tokens: res.tokens,
          latencyMs: res.latencyMs,
          recordedAt: new Date().toISOString(),
        });
      }
      return { value, cached: false, latencyMs: res.latencyMs, tokens: res.tokens };
    },
  };
  return client;
}

export class SchemaViolationError extends Error {
  constructor(promptVersion: string, detail: string) {
    super(`Schema violation from ${promptVersion}: ${detail}`);
    this.name = "SchemaViolationError";
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, text: string, promptVersion: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SchemaViolationError(promptVersion, `not JSON: ${text.slice(0, 160)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaViolationError(promptVersion, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
