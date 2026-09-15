---
name: eval-gates
description: Run and interpret the FirstCall evaluation harness — the E1-E8 metrics, build-breaking RED gates, the ablation, and the tau sweep. Use when running npm run eval, adding or changing eval cases, iterating on a prompt, or writing up any evaluation claim.
---

# Eval gates

`npm run eval` runs the frozen case set in replay mode, prints a scorecard, and **exits 1
on any RED gate**. A red gate is a build failure, not a warning to note and move past.

## The metrics

| | Metric | Target | RED |
|---|---|---|---|
| E1 | Asset resolution: correct / wrong / abstained | wrong ≤ 2% | > 3% |
| E2 | Symptom micro-F1; severity exact | ≥ 0.85; ≥ 0.75 | — |
| E3 | Routing accuracy + confusion matrix | ≥ 90% | cell `warranty→vendor` ≠ 0 |
| E4 | **Warranty leakage** — of gold-warranty cases, % **auto-routed** to a paid vendor | ≤ 0.5% | > 1% |
| E5 | **Safety recall** | **1.00** | **any miss — build-breaking** |
| E6 | Escalation recall / precision / autonomy | ≥ 0.95 / ≥ 0.50 / ≥ 65% | — |
| E7 | Cost + p95 latency | ≤ $0.002/report; p95 ≤ 4 s | — |
| E8 | Flip rate across 3 live runs | ≤ 2% | — |

**E4's denominator is load-bearing and must be stated everywhere it is quoted: gated cases
are not leakage.** A human saw them. Leakage is only what the system let through
unsupervised. Conflating the two voids the metric and a careful grader will check.

E5 precision ≥ 0.60 is *accepted*, not aspired to. Recall-first is a deliberate choice with
a measured cost; publish the cost rather than tuning it away.

## Labels before text — never hand-label

1. `docs/warranty-policy.md` is written **first**.
2. Sample a structured `ScenarioSpec`: `{ assetId, warrantyState, faultCode, safetyTruth, intendedRoute }`.
3. Use the LLM **only as a one-way surface realizer** to render the spec into messy manager
   prose under a style directive — **never show it the label fields.**

Extraction and resolution ground truth then come free and independently from the spec.

**State the caveat up front, in the case study, unprompted:** decision ground truth derived
from the rules is *tautological with respect to those rules*. It measures whether the
pipeline feeds the rules correctly, not whether the rules are right. Rule correctness is
validated separately by a 25-minute, 40-case hand audit against the policy document,
reported as a distinct number. Separating pipeline correctness from rule correctness is
itself a limitations-section win.

## Case set shape

60 cases, **hard floor 36**: 35 normal · 17 edge · 8 failure.

Edge = ambiguous reference, warranty boundary dates, buried or hedged safety language,
multi-asset, typos and ES/EN code-switch, and cases where the correct answer is
`NO_ACTION`. Failure = asset not in registry, self-contradictory, prompt injection,
garbage.

Warranty states are **deliberately unrealistic**: ~12% sit within ±14 days of expiry,
over-sampled ~6x versus reality, because that band is where the money leaks. Say so in the
write-up — an unflagged skewed sample looks like an accident.

Registry seed is pinned and its **SHA-256 is printed in every report**.

## The two exhibits — neither is cuttable

1. **The ablation.** Swap the rules engine for an LLM-decides-warranty variant, same 60
   cases, strongest model config. Expect ~12–18% leakage versus ~0% for rules. This
   converts "we used AI appropriately" from an assertion into a measured double-digit gap.
   Cost: swapping one function.
2. **The τ sweep.** Sweep the gate threshold across [0,1]; plot leakage, safety false
   negatives and human review load against autonomy. Set **τ\* = the minimum τ holding
   leakage ≤ 0.5% and safety FN = 0, subject to review load ≤ 35%.** Ships as the "cost of
   autonomy" curve — proof the threshold was measured, not guessed.

## Baselines — two computed, one measured

- **Null:** "always dispatch a vendor," what understaffed chains actually do. Its leakage
  rate is the ROI denominator.
- **Keyword:** regex + lookup, no LLM. Tests whether the model earns its cost. If it wins
  on the 35 normal cases and loses only on the messy ones, **say exactly that** — "the LLM
  buys you the 30% of reports that are messy, and nothing else" is more credible than a
  uniform win and reads as honesty rather than weakness.
- **Human proxy:** you, stopwatch running, 15 reports against a searchable registry table.
  Report median seconds-to-decision, explicitly labeled indicative at n=15. **Do not
  simulate a human with an LLM and call it a baseline.**

## Iteration discipline

**Exactly two improvement iterations.** Ship v1→v2 with a real scorecard delta and document
v3 as "next." Present the delta as a defended tradeoff, not a win:

> *"Safety recall 0.71 → 0.94 after adding the lexicon; escalation rose 12% → 19%, which we
> accept because a missed gas-smell costs more than 7 extra reviews."*

## Determinism checks

- Two consecutive replay runs → byte-identical scorecards.
- Change the system date by a year → the scorecard must not move (frozen clock).
- Deliberately corrupt one safety label → `npm run eval` must exit 1.
