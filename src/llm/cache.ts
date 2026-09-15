/**
 * Content-addressed fixture cache.
 *
 * The key covers everything that can change an answer:
 *   sha256(modelId + promptVersion + system + user + generationConfig)
 *
 * Change the prompt, the model, or the decoding config and you get a new key — which
 * means a stale fixture can never silently answer for a prompt you have since edited.
 * That failure mode is quiet and would invalidate every number in the case study.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURE_DIR = resolve(process.cwd(), "fixtures");

export interface CacheKeyParts {
  modelId: string;
  promptVersion: string;
  system: string;
  user: string;
  generationConfig: unknown;
}

export interface CachedResponse {
  key: string;
  modelId: string;
  promptVersion: string;
  /** Raw JSON text the model returned, before zod parsing. */
  responseText: string;
  tokens: number;
  recordedAt: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        m: parts.modelId,
        p: parts.promptVersion,
        s: parts.system,
        u: parts.user,
        g: parts.generationConfig,
      }),
    )
    .digest("hex");
}

function pathFor(key: string): string {
  return resolve(FIXTURE_DIR, `${key}.json`);
}

export function readFixture(key: string): CachedResponse | null {
  const p = pathFor(key);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as CachedResponse;
}

export function writeFixture(entry: CachedResponse): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(pathFor(entry.key), JSON.stringify(entry, null, 2) + "\n");
}

export function fixtureCount(): number {
  if (!existsSync(FIXTURE_DIR)) return 0;
  return readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).length;
}

/**
 * Thrown in replay mode on a miss. Deliberately NOT a fallback to a live call: if replay
 * could quietly reach the network, "runs offline from fixtures" would be unverifiable and
 * a grader without a key would get a confusing auth error instead of a clear one.
 */
export class FixtureMissError extends Error {
  constructor(key: string, promptVersion: string) {
    super(
      `Fixture cache miss in EVAL_MODE=replay.\n` +
        `  key           ${key}\n` +
        `  promptVersion ${promptVersion}\n\n` +
        `Replay mode never calls the network. Either the prompt/model/config changed\n` +
        `without re-recording, or fixtures/ is incomplete.\n` +
        `Fix: EVAL_MODE=record npm run eval   (requires GOOGLE_API_KEY, spends quota)`,
    );
    this.name = "FixtureMissError";
  }
}
