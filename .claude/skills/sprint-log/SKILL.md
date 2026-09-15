---
name: sprint-log
description: Track effort against the 40-hour hard cap, write the daily process note, and apply the pre-committed cut list when behind schedule. Use at the start and end of every work session, and whenever deciding what to drop.
---

# Sprint log

**40 hours of effort, hard cap.** Effort, not wall-clock — "Day 1" means the first 8-hour
block, starting whenever it starts. The cap is itself graded, and **a truthful hour log is
a cheap credibility signal** while an implausible one is expensive.

## Every session

**Start:** read `docs/process/` for the running total. State the remaining budget and what
this session is spending it on.

**End:** append to `docs/process/dN.md` — actual hours, what shipped, what slipped, one
decision and why. **30 minutes per day, capped.** Bullets and one diagram, zero formatting.
These are raw material for the Day 5 edit pass, not finished prose.

```
## Session N — Xh (running total: Yh / 40)
- built: …
- decided: … because …
- slipped: … → cut list item N applied / deferred to …
- open: …
```

## The budget

| Day | Focus | Hours |
| --- | --- | --- |
| D1 | Problem, baseline $ model, gold set, repo spine | 8.0 |
| D2 | Design artifacts + agent core part 1 | 8.0 |
| D3 | Prototype complete, deployed, replay verified | 8.0 |
| D4 | Evaluation, ablation, τ sweep, two iterations | 8.0 |
| D5 | Case study, handoff, 60-day plan, video | 8.0 |

Build is capped at **~13 hours total**. **55% of the grade is framing, judgment, evaluation
and communication; 20% is the prototype.** When tempted to polish the UI, go write the
cost-of-error table instead.

## The cut list — decide now, not at 11pm on Day 3

Cut **strictly top-down** the moment you are >90 minutes behind.

| # | Cut | Saves |
| --- | --- | --- |
| 1 | Bias analysis → 6-case probe + an honest "here is the test I'd run at n=500" | 1.0h |
| 2 | Dispatch screen → terminal-state banner on Review (3 screens → 2) | 1.5h |
| 3 | LLM-written vendor email → template + one LLM-written symptom line | 1.5h |
| 4 | Second improvement iteration → ship v1→v2, document v3 as next | 1.5h |
| 5 | Vercel deploy → local + video (README must then be flawless) | 1.5h |
| 6 | Service blueprint → journey map with inline back-stage annotations | 1.0h |
| 7 | Case set 60 → 36. **Hard floor 36.** | 1.0h |

## Never cuttable — the graded spine

- All five pipeline stages exist. GATE is ~40 minutes and is the clearest evidence of AI
  operating judgment in the whole build.
- Case set + harness + a **v1→v2 scorecard with real numbers**.
- The ablation.
- The human-vs-agent baseline table — it alone carries much of Business 15% and Evaluation 15%.
- The minute-level as-is workflow and the warranty-leakage $ model.
- **Offline fixture mode.** If a grader without a key cannot run it, the prototype scores
  near zero regardless of quality.
- The 8-page and 5-minute caps.

## Pre-empted failure modes

| Failure | p | Countermeasure |
| --- | --- | --- |
| UI overbuild | 0.65 | 3 routes, no auth, no DB, nothing below 1024px. One 20-min styling pass on Day 5, never before. |
| Eval written after the build | 0.55 | **The first prompt written is scored within 60 minutes of being written.** |
| Synthetic data too clean | 0.70 | Difficulty ladder + 6x over-sampled warranty boundary band. |
| Blowing a stated cap | 0.50 | Per-section word budget written on Day 2. |
| Prompt rabbit-holing | 0.45 | **Two scored revisions per stage, then stop.** The rest becomes a documented remaining risk — worth more rubric points than silently fixing it. |

## Where marginal hours pay best, in order

1. Cost-of-error asymmetry + decision-rights tables — then show τ\* was set *from* that asymmetry
2. Minute-level as-is workflow + how you would instrument leakage at the customer in week 1
3. The v1→v2 delta presented as a defended tradeoff
4. A second video take that opens on the dollar number
5. Last, and only last: any UI work beyond functional
