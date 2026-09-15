/**
 * Raw Gemini transport. Everything here was established by probing the live API rather
 * than by reading documentation — see the gemini-budget skill for the measurements.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Free tier is limited per MINUTE, not per day — measured the hard way: a 1.1s floor
 * (~54 rpm) exhausted quota after 49 calls, while total tokens were nowhere near any
 * limit. ~4.5s (~13 rpm) sits under the observed ceiling with headroom for retries.
 *
 * This is the constraint that actually governs the eval budget, which is the whole
 * argument for the fixture cache: a re-run at zero requests is not an optimisation here,
 * it is the difference between a suite you can iterate on and one you cannot.
 */
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 4500);
let lastCallAt = 0;

async function throttle(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/**
 * 503 matters as much as 429 here. The free tier returns
 * `503 "This model is currently experiencing high demand"` routinely, and a 60-case run
 * that dies at case 41 with no retry is a self-inflicted wound.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

export interface GeminiRequest {
  modelId: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  thinkingLevel: "low" | "high";
  apiKey: string;
}

export interface GeminiResponse {
  text: string;
  tokens: number;
  latencyMs: number;
}

export function buildGenerationConfig(jsonSchema: Record<string, unknown>, thinkingLevel: "low" | "high") {
  return {
    // temperature 0 + topK 1 is the determinism floor. It is not a guarantee, which is
    // why the residual flip rate (E8) gets measured and published rather than assumed.
    temperature: 0,
    topK: 1,
    responseMimeType: "application/json",
    responseSchema: jsonSchema,
    thinkingConfig: { thinkingLevel },
  };
}

export async function callGemini(req: GeminiRequest): Promise<GeminiResponse> {
  // NOTE: `${M}:generateContent`, never "$M:generateContent" in a shell — zsh parses `:g`
  // as a parameter modifier and mangles the URL into a phantom 404. Same trap, different
  // language; keeping the reminder where the URL is built.
  const url = `${API_BASE}/${req.modelId}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: buildGenerationConfig(req.jsonSchema, req.thinkingLevel),
  };

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle();
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = `network: ${(e as Error).message}`;
      await backoff(attempt);
      continue;
    }

    if (RETRYABLE.has(res.status)) {
      const bodyText = await res.text();
      lastErr = `${res.status} ${bodyText.slice(0, 200)}`;
      // Honour the server's own RetryInfo when it gives one — guessing shorter than the
      // service asked for is how a retry storm turns a transient 429 into a hard failure.
      await backoff(attempt, parseRetryDelay(bodyText));
      continue;
    }
    if (!res.ok) {
      // Non-retryable: bad key, bad schema, or a model that 404s for this key. The model
      // list advertises models a new free-tier key cannot call, so 404 here is common and
      // must fail loudly rather than be retried into a timeout.
      throw new Error(`Gemini ${res.status} on ${req.modelId}: ${(await res.text()).slice(0, 400)}`);
    }

    const json = (await res.json()) as any;
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      lastErr = `no text part: ${JSON.stringify(json).slice(0, 200)}`;
      await backoff(attempt);
      continue;
    }
    return {
      text,
      tokens: json?.usageMetadata?.totalTokenCount ?? 0,
      latencyMs: Date.now() - started,
    };
  }
  throw new Error(`Gemini failed after ${MAX_ATTEMPTS} attempts on ${req.modelId}. Last: ${lastErr}`);
}

/** Exponential with jitter — unjittered backoff resynchronises retries into a new spike. */
async function backoff(attempt: number, serverHintMs = 0): Promise<void> {
  const base = Math.min(1000 * 2 ** (attempt - 1), 32000);
  await new Promise((r) => setTimeout(r, Math.max(base, serverHintMs) + Math.random() * 500));
}

/** Google returns RetryInfo as `"retryDelay": "27s"` inside error.details. */
function parseRetryDelay(body: string): number {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) : 0;
}
