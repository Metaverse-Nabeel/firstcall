# 60-day validation plan

What would have to be true for this to be worth building, and how we would find out — with
thresholds set before the data arrives, so a disappointing result cannot be renegotiated
into a good one afterwards.

---

## Rollout

| Phase | Days | What runs | What the coordinator sees |
|---|---|---|---|
| **Shadow** | 1–14 | Everything, on 100% of intake | Nothing |
| **Assist** | 15–45 | Everything | Recommendation + audit trail, one-click accept/override |
| **Limited autonomy** | 46–60 | Everything | Only gated cases; auto-file claims when confidence ≥ τ\*, cost < $500, no safety flag |

**Override requires a reason code** from a fixed 8-item taxonomy — wrong unit, wrong
symptom, warranty wrong, severity wrong, vendor wrong, policy exception, data stale, other.
That single click is the entire feedback loop. There is no online learning; the codes are
read by humans and turned into rule or prompt changes deliberately.

**Shadow runs on 100% of intake by construction**, which removes selection bias from the
phase that produces the baseline.

---

## Why leakage is NOT the primary metric

This is the part most pilot plans get wrong, so it is stated first.

```
100 stores × 2.5 reports/month × 2 months ≈ 500 reports
500 × ~30% warranty-eligible               ≈ 150 events
```

Detecting an 18% → 8% improvement at 80% power needs **≈181 per arm**. At 150 events total,
the study is **underpowered before it starts.**

Worse, **invoices arrive 30–45 days after the job.** A day-60 read sees roughly 55% of
relevant invoices, and the ones that have arrived are biased toward fast-invoicing vendors —
who are not a random sample.

Reporting leakage as the headline at day 60 would mean reporting a noisy, biased,
underpowered number as if it settled the question.

### Primary metric instead: warranty-determination compliance

> Of dispatched jobs on warranty-eligible assets, the share carrying a recorded,
> coordinator-confirmed-correct warranty verdict **at the moment of dispatch**.

It is the causal mechanism for leakage, it fires on all 150 events rather than the ~55% with
returned invoices, and it is readable in real time.

**Leakage becomes the lagging confirmatory metric, read at day 90.**

For a directional read earlier: every shadow-phase case where the system said COVERED and
the coordinator paid anyway is a **"would-have-leaked" near-miss** with a dollar value
attached. Those are available from day 14 and are the most persuasive artifact in the whole
pilot, because each one is a specific invoice someone can look up.

---

## Decision thresholds

Set now. Not adjustable after seeing the data.

### PROCEED — all of:

| | Threshold |
|---|---|
| Determination coverage | ≥ 95% |
| Verdict agreement with coordinator | ≥ 90% |
| **Safety false negatives** | **0** |
| Time-to-dispatch | −30% vs shadow baseline |
| Override rate | ≤ 20% |
| Autonomy | ≥ 50% |
| Leakage point estimate | ≤ 10%, upper 95% bound ≤ 14% |

### ITERATE — safety FN = 0 **and** any of:

verdict agreement 75–90% · override 20–35% · leakage 10–15%.

Extend 30 days, narrowed to the top-2 override reason codes. Iterating on everything at once
is how a pilot becomes a permanent pilot.

### STOP — any of:

- **One safety false negative reaching dispatch.** Not a rate. One.
- Leakage CI includes zero improvement *and* point estimate ≥ baseline − 2pp
- Override > 40% at day 45
- Time-to-dispatch flat or worse
- Any single incident > $10k attributable to an automated decision

---

## The confound that matters most

**Deploying this forces someone to clean the asset registry.** The gain may come from clean
data, not from AI.

This is the most likely way to get a positive result for the wrong reason, and it is easy to
test for:

1. Freeze a **day-0 registry snapshot**.
2. Log every registry edit made during the pilot.
3. At day 60, **re-score every assisted decision against the day-0 snapshot.**

If the improvement does not survive re-scoring, the honest recommendation is **"buy a data
cleanup project, not an AI product."**

Writing that sentence down before the pilot starts is worth more than the pilot passing —
and a team unwilling to write it should not be trusted with the result.

### Other confounds, pre-empted

| Confound | Control |
|---|---|
| Invoice lag | Leakage read at day 90, not day 60 |
| Seasonality | Concurrent 20-store holdout, never pre/post alone |
| Hawthorne effect in the holdout | Holdout coordinators are not told which stores are instrumented |
| Selection bias | Shadow phase covers 100% of intake by construction |
| Novelty effect on override rate | Compare days 15–25 against days 35–45 within the assist phase |

---

## Instrumentation required in week 1

Nothing here is exotic; all of it has to exist before day 1 or the pilot produces anecdotes.

1. Timestamp on report received and on work order issued (time-to-dispatch).
2. Warranty verdict + rule IDs written to the CMMS note field on every dispatch.
3. Override events with reason code.
4. Registry snapshot hash, recomputed nightly.
5. AP invoice export joined to work order ID — the single hardest integration, and the one
   leakage measurement depends on entirely. If it cannot be built, say so on day 1 rather
   than discovering it at day 60.

---

## Cost framing

Measured ~250 tokens per report across both LLM calls at `thinkingLevel: "low"`, which is
≈ **$0.000025** at published `gemini-3.5-flash-lite` list price. One prevented claim (~$780)
pays for roughly **30 million reports.**

Inference cost is not a decision variable at this scale. **Escalation labour is** — 35%
review load on 120 stores is ~140 reports/day and needs an owner. Which is the whole reason
the τ sweep exists: the economic lever is the gate threshold, not the model.
