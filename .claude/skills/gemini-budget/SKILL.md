---
name: gemini-budget
description: Spend free-tier Gemini quota deliberately — model pinning, thinking config, fixture-cache replay, and 429/503 backoff. Use before writing any code that calls the API, before an eval run that may hit the network, and when a call fails or the budget looks tight.
---

# Gemini free-tier budget

The key is **free tier**. **Requests per day is the binding constraint, not tokens** — calls
run ~45–200 tokens each. The whole design point of the fixture cache is that an unchanged
prompt version costs **zero** requests.

## Pinned configuration — verified live, do not re-derive

```ts
model: "gemini-3.5-flash-lite"
generationConfig: {
  temperature: 0,
  topK: 1,
  responseMimeType: "application/json",
  responseSchema: <the zod-derived schema>,
  thinkingConfig: { thinkingLevel: "low" },
}
```

Measured on the real extraction task: **0 thought tokens, 71 total tokens, 1.2 s.**

Three findings that cost real time to establish:

1. **The model list lies.** `GET /v1beta/models` returns 41 models including the whole 2.5
   family, but a new free-tier key gets `404 … no longer available to new users` on most.
   **Only call a model that has actually returned 200 here:** `gemini-3.5-flash-lite`,
   `gemini-3.6-flash`. Never pin a model from documentation.
2. **Thinking is on by default and costs ~20x.** Default 3.6-flash spent **521 thought
   tokens on a 16-token prompt**. Always set `thinkingConfig.thinkingLevel` explicitly.
   EXTRACT is span-grounded classification against a closed vocabulary — it does not need
   reasoning, and all tested configs returned the correct extraction anyway.
3. **The free tier returns 503, not only 429.** `503 "currently experiencing high demand"`
   is routine. Back off exponentially on **both**, plus a client-side rate limiter. A
   60-case eval run that dies at case 41 with no retry logic is a self-inflicted wound.

## Spend rules

- **`EVAL_MODE=replay` is the default and must never touch the network.** A cache miss in
  replay is a **hard error**, not a silent API call. This is what makes the grader's
  keyless run honest — if it quietly fell back to live, the reproducibility claim is false.
- Live calls are legitimate in exactly three places: `record` mode populating fixtures, the
  E8 flip-rate run (`--repeat 3`), and one-off probes during prompt iteration.
- **Budget: ~800 requests across Days 2–4.** Data-gen realizer ~60, cases 60 x 2 calls x 3
  prompt versions, ablation ~120, flip-rate ~180. Spread across days it fits comfortably.
  Day 5 re-runs cost nothing.
- **Two scored prompt revisions per stage, then stop.** Rabbit-holing burns quota and hours
  for points a documented remaining-risk paragraph would have scored anyway.

## Ablation fairness

The LLM-decides-warranty variant must run on the **strongest** config — `gemini-3.6-flash`,
`thinkingLevel: "high"` — while the shipped pipeline runs flash-lite on low. If rules still
beat a stronger, thinking-enabled model, that is evidence. Beating a deliberately weakened
model is a strawman, and a grader will notice.

## Shell gotcha

In zsh, `"…/models/$M:generateContent"` silently mangles the URL — `:g` parses as a
parameter modifier and you get phantom 404s. Always write `${M}:generateContent`.

## Key handling

`GOOGLE_API_KEY` lives in `.env.local` only. It must never reach a commit, a fixture file,
a screenshot, or the demo video. The current key was pasted into a chat transcript —
**rotate it at aistudio.google.com/apikey after submission.**
