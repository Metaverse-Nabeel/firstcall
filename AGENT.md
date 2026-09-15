# AGENT.md — the FirstCall triage agent

Specification of the agent itself: what each stage may decide, what it may never decide,
and what happens when it is unsure. `CLAUDE.md` covers how work is done in this repo.

> **Scope note.** This document is the contract. If the code and this file disagree, one of
> them is a bug — fix both in the same commit.

---

## The job

A facilities coordinator for 40–120 QSR stores receives free-text breakdown reports from
store managers:

> *"Fryer 2 tripping the breaker, smells burnt, had to shut the line"*

For each one they manually pull the asset record, check warranty, check vendor SLA, then
route. The **lookup-and-route step** is the bottleneck: repetitive, done under time
pressure while a store loses revenue, and wrong in a measurable way.

**The money metric is warranty leakage** — paying a vendor to repair an asset still under
manufacturer warranty. Baseline ≈ $16.5k/yr for an 80-store chain. Secondary costs:
time-to-dispatch (22 min avg), misroutes.

---

## Governing principle: asymmetric authority

> **The LLM may only move a decision toward the cheap-to-be-wrong side** — escalate to a
> human, or preserve a warranty claim. It may never move a decision toward the expensive
> side: pay a vendor, void coverage, or lower a severity.

Every stage below is built against this rule. It is what makes the injection-resistance
and warranty-accuracy results **structural rather than lucky**, and it is the strongest
single answer to "does this use AI appropriately."

The cost asymmetry it encodes:

| Error | Cost |
| --- | --- |
| False "out of warranty" | You pay ~$780 you did not owe |
| False "in warranty" | Rejected claim **plus** ~6 days of additional downtime |
| Missed safety flag | Unbounded |
| Unnecessary escalation | ~4 minutes of coordinator time |

Escalation is three orders of magnitude cheaper than the errors it prevents. That is why
τ\* is set *from* the asymmetry rather than guessed.

---

## Pipeline

Five stages. **Two are LLM, three are deterministic**, and which is which is the design.

| # | Stage | Impl | Emits | Fallback |
|---|---|---|---|---|
| 1 | EXTRACT | **LLM** | `assetMentions[]` as descriptors, `symptomCodes[]`, `safetyIndicators[]`, `severityHint` + evidence span | Schema violation → one retry → lexicon-only extraction with `c_extract = 0`, forcing the gate |
| 2 | RETRIEVE | deterministic | resolved asset or `ambiguous` / `notInRegistry`, `topMargin` | Ambiguous → hard gate, ranked candidates surfaced for a one-click pick |
| 3 | DECIDE | deterministic | `warrantyVerdict`, `rulesFired[]`, `route`, `costExposure`, `slaDeadline` | Any `UNKNOWN` input → `UNKNOWN_MISSING_DATA` → gate. Never auto-routes to a paid vendor. |
| 4 | DRAFT | **LLM, prose only** | exactly two free-text fields on an otherwise structured work order | Ungrounded token → template-only draft, `c_draft = 0`, flagged |
| 5 | GATE | deterministic | `autonomous \| review \| escalate` + the reason | — |

### 1. EXTRACT — LLM

`temperature: 0`, structured output (`responseMimeType: application/json` + `responseSchema`).

**The LLM never emits an `assetId`.** It emits *descriptors*: the surface text, a type
enum, an ordinal hint. Resolution against the registry is stage 2's job and is
deterministic. This single constraint is what makes prompt injection structurally
uninteresting — an attacker who controls the report text can influence a descriptor, but
cannot name an asset that resolution will not independently confirm.

`symptomCodes` and `safetyIndicators` draw from a **closed vocabulary**. `severityHint`
requires an evidence span quoted from the source text; a severity with no span is dropped.

### 2. RETRIEVE — deterministic

Block on `storeId`, then score candidates on tag / type / ordinal / model / location.
`topMargin` (the gap between the best and second-best candidate) drives `c_resolve`.
Registries carry 2–4 same-class units per store, which is what manufactures genuine
ambiguity — a single fryer per store would make this stage a no-op and the eval a lie.

Missing joins are typed `UNKNOWN` and propagate. Never defaulted.

### 3. DECIDE — deterministic rules engine

Implements `docs/warranty-policy.md`. Routing is a ~28-row decision table, unit-tested.
`rulesFired[]` is the audit trail and is surfaced verbatim in the UI.

**Why warranty determination must not be the LLM** — the centrepiece argument:

1. **It is date arithmetic over structured fields, not language.** The language was already
   consumed by EXTRACT. There is nothing left for a language model to do.
2. **It is the money metric.** Behind a stochastic function it becomes unimprovable by
   engineering — you can only re-prompt and hope. Rules give a failing case a line number.
3. **It is a disputed financial claim.** When a manufacturer rejects it, the audit trail
   must read *"rules W-12, W-04 fired, in-service 2024-03-11, term 24mo, PM log complete."*
   "The model thought so" is not a position you can take to a vendor.

This is measured, not asserted: the ablation swaps in an LLM-decides-warranty variant on
the strongest available config and reports the leakage gap.

### 4. DRAFT — LLM for prose only

The work order is populated entirely from structured data. The LLM writes exactly two
free-text fields.

A deterministic **groundedness checker** then regex-extracts every numeral, date, amount
and asset tag from the generated prose and asserts membership in the structured payload.
One ungrounded token fails the whole draft to a template.

### 5. GATE — deterministic

```
confidence = min(c_extract, c_resolve, c_decide, c_draft)
```

**`min`, not product** — it names the weak link, which drives the "why was this escalated"
string directly. A product would produce a number no one can act on.

**Hard gates override the threshold entirely:**

- safety flag raised
- ambiguous asset reference
- asset not in registry
- `UNKNOWN_MISSING_DATA`
- cost exposure > $2,500
- multi-asset report
- **failure date within ±30 days of warranty expiry** — the boundary band is where money is
  lost and models are least reliable

---

## Confidence is computed, not asked

A model asked "are you confident?" produces a confidence-shaped token sequence, not a
probability. Instead:

- **`c_extract`** — run the deterministic safety/symptom lexicon *in parallel* with the LLM
  and score field-level agreement between the two extractors. **Zero extra API calls.**
- **`c_resolve`** — from `topMargin`.
- **`c_decide`** — 1.0 unless an `UNKNOWN` participated.
- **`c_draft`** — 0 if the groundedness check failed, else 1.0.

```
safetyFlag = lexicon.hit || llm.safetyIndicators.length > 0
```

Recall-first by construction. The precision cost is real and gets measured and published
(E5: recall 1.00 build-breaking, precision ≥ 0.60 accepted) rather than hidden.

---

## Determinism

`temperature: 0`, `topK: 1`, pinned model version, versioned prompt strings, and a
content-addressed fixture cache keyed on:

```
sha256(modelId + promptVersion + request + generationConfig)
```

Three modes via `EVAL_MODE`: `replay` (default, no network, **a cache miss is a hard
error**), `record`, `live`.

Then **measure the residual** — publish the E8 flip rate across three live runs rather than
claiming a determinism that has not been demonstrated.

---

## What this agent does not do

Stated here so it is stated in the case study too:

- It does not decide warranty. Rules do.
- It does not dispatch to a paid vendor without a human, ever, at any confidence.
- It does not resolve an asset it cannot find in the registry — it says so and stops.
- It does not learn from feedback. Override reason codes are collected for humans to read;
  there is no online training loop, and claiming one would be the easiest lie to tell in
  the demo video.
