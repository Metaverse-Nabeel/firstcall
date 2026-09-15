# FirstCall — 5-Day, 40-Hour AI-Native Product Sprint

## Context

A recruiter has set a 5-business-day, 40-hour-capped sprint: pick one real customer problem,
design a near-future AI-native solution, build a working prototype, test it on synthetic data,
and ship a portfolio case study, handoff doc and ≤5-minute demo video.

`/Users/nabeelahmed/AgenticAI/MUST` is empty today. It becomes a **public** GitHub repo holding
**only the graded deliverables** — no scratch notes, no raw research, no video binaries, no keys.
That is a first-class requirement: a public repo whose entire history is timestamped inside the
sprint window is itself the cleanest possible Prior-Work Disclosure.

Locked decisions (confirmed with you):

| Decision | Choice |
| --- | --- |
| Problem | Asset breakdown triage for a multi-site QSR facilities coordinator |
| Prototype | Next.js + TypeScript — typed agent core, thin web UI, shared CLI eval harness |
| Model | Google Gemini via `GOOGLE_API_KEY`, with offline fixture replay |
| Repo hygiene | Working files live **outside** the repo, in a sibling folder |

Grading weights drive every tradeoff below: Problem 20%, Product/UX 20%, AI logic 20%,
Business/ops 15%, Evaluation 15%, Communication 10%. **55% of the grade is framing, judgment,
evaluation and communication; 20% is the prototype.** The plan therefore caps build at 13 hours.

---

## Model configuration — verified live against your new key

The replacement key works. I probed it rather than trusting the docs, and three findings change
the build:

**1. The model list lies. Pin a model you have actually called.**
`GET /v1beta/models` returns 41 models including the whole 2.5 family, but calling
`gemini-2.5-flash` returns 404: *"no longer available to new users."* A new free-tier key can only
use the 3.x family. Verified working: **`gemini-3.6-flash`** and **`gemini-3.5-flash-lite`**, both
with `responseMimeType: application/json` + `responseSchema`, which is what EXTRACT depends on.

**2. Thinking is on by default and costs ~20× the tokens. Turn it down.**
Measured on the real fryer report, identical schema:

| Model | `thinkingLevel` | thought tok | output tok | total | latency |
|---|---|---|---|---|---|
| `gemini-3.6-flash` | low | **0** | 29 | **45** | 1.5 s |
| `gemini-3.5-flash-lite` | low | **0** | 55 | 71 | 1.2 s |
| `gemini-3.1-flash-lite` | low | 141 | 56 | 213 | 2.5 s |
| `gemini-3.5-flash-lite` | high | 818 | 25 | 859 | 3.2 s |
| `gemini-3.1-flash-lite` | high | 1180 | 34 | 1230 | 6.9 s |

Default (no `thinkingConfig`) on 3.6-flash burned **521 thought tokens for a 16-token prompt**.
EXTRACT is span-grounded classification against a closed vocabulary — it does not need reasoning.
**Pin `gemini-3.5-flash-lite` with `thinkingLevel: "low"` for EXTRACT and DRAFT**, and record the
exact model string in the fixture cache key. All five rows above produced the correct extraction,
so the 17× token saving costs nothing in quality on this task.

**3. The free tier returns 503, not just 429.** `gemini-3.6-flash` at `thinkingLevel: "high"`
returned `503 "This model is currently experiencing high demand."` on the first attempt. The LLM
client therefore needs **exponential backoff on both 429 and 503** plus a client-side rate limiter
from the very first commit — a 60-case eval run that dies at case 41 on Day 4 with no retry logic
is a self-inflicted wound. Build it into `src/llm/` on Day 2, not when it first bites.

**Free-tier budget.** Tokens are not the constraint at ~45–200 tokens/call; **requests per day**
are. The content-addressed fixture cache is what makes this affordable: re-running an unchanged
prompt version costs **zero** requests. Only new prompt versions spend quota. Realistic spend:
60 surface-realizer calls (data gen) + 60 cases × 2 calls × 3 prompt versions + 60 ablation calls
× 2 + 180 flip-rate calls ≈ **~800 requests across Days 2–4**, well inside a day's free allowance
if spread out — and re-runs during case-study writing on Day 5 cost nothing at all.

> **Ablation fairness.** The LLM-decides-warranty variant must run on the *strongest* config
> (`gemini-3.6-flash`, `thinkingLevel: "high"`) while the shipped pipeline runs flash-lite on low.
> If rules still beat a stronger, thinking-enabled model, the result is evidence. Beating a
> deliberately weakened model is a strawman, and a grader will notice.

> Shell gotcha, since this bit me while probing: in zsh, `"…/models/$M:generateContent"` silently
> mangles the URL — `:g` is parsed as a parameter modifier. Always write `${M}:generateContent`.

---

## The product

**FirstCall** — the AI triage desk for multi-site facilities operations.

**User.** A facilities coordinator for 40–120 QSR stores. Store managers report breakdowns as free
text ("Fryer 2 tripping the breaker, smells burnt, had to shut the line"). For each one the
coordinator manually pulls the asset record, checks warranty, checks vendor SLA, then routes.

**Bottleneck.** The lookup-and-route step — repetitive, done under time pressure while a store
loses revenue, and wrong in a measurable way: **warranty leakage**, paying a vendor to repair an
asset still under manufacturer warranty. Secondary costs: time-to-dispatch, misroutes.

### Governing design principle: asymmetric authority

**The LLM may only move a decision toward the cheap-to-be-wrong side** — escalate to a human, or
preserve a warranty claim. It can never move a decision toward the expensive side (pay a vendor,
void coverage, lower a severity). Every stage is built against this rule. It is what makes the
injection-resistance and warranty-accuracy results *structural* rather than lucky, and it is the
strongest single answer to "uses AI appropriately."

### Pipeline

| # | Stage | Impl | Contract highlights | Fallback |
|---|---|---|---|---|
| 1 | EXTRACT | **LLM**, `temperature: 0`, structured output | Emits `assetMentions[]` as *descriptors* — surface text, type enum, ordinal hint. **Never an `assetId`.** Closed vocab for `symptomCodes` and `safetyIndicators`; `severityHint` requires an evidence span. | Schema violation → one retry → lexicon-only extraction with `c_extract = 0`, which forces the gate |
| 2 | RETRIEVE | **Deterministic** | Block on `storeId`, score candidates (tag / type / ordinal / model / location), compute `topMargin`. Emits `ambiguous`, `notInRegistry`. Missing joins typed `UNKNOWN`, never defaulted. | Ambiguous → hard gate, ranked candidates surfaced for a one-click pick |
| 3 | DECIDE | **Deterministic rules engine** | `warrantyVerdict`, `rulesFired[]` (the audit trail), `route`, `costExposure`, `slaDeadline`. Routing is a ~28-row decision table, unit-tested. | Any `UNKNOWN` input → `UNKNOWN_MISSING_DATA` → gate. Never auto-routes to a paid vendor. |
| 4 | DRAFT | **LLM for prose only** | Work order populated entirely from structured data; the LLM writes exactly two free-text fields. A deterministic **groundedness check** asserts every numeral, date, amount and asset tag in the prose exists in the structured payload. | Ungrounded token → fall back to template-only draft, `c_draft = 0`, flag for review |
| 5 | GATE | **Deterministic** | `confidence = min(c_extract, c_resolve, c_decide, c_draft)`. `min`, not product — it names the weak link and drives the "why was this escalated" string directly. | — |

**Why warranty determination must not be the LLM** (this argument is the centrepiece of the case
study's AI Logic section):

1. It is date arithmetic over structured fields, not language. The language was already consumed
   by EXTRACT.
2. It *is* the money metric. Behind a stochastic function it becomes unimprovable by engineering —
   you can only re-prompt and hope. Rules give a failing case a line number.
3. It is a disputed financial claim. When a manufacturer rejects it, the audit trail must read
   "rules W-12, W-04 fired, in-service 2024-03-11, term 24mo, PM log complete." "The model thought
   so" is not a position.

**`c_extract` is computed, not asked.** A model asked "are you confident?" produces a
confidence-shaped token sequence, not a probability. Instead: run the deterministic safety/symptom
lexicon in parallel with the LLM and score field-level agreement between the two extractors. Zero
extra API calls. `safetyFlag = lexicon.hit || llm.safetyIndicators.length > 0` — recall-first by
construction; the precision cost gets measured and published.

**Hard gates override the threshold entirely:** safety flag, ambiguous asset, not in registry,
`UNKNOWN_MISSING_DATA`, cost > $2,500, multi-asset, and **failure date within ±30 days of warranty
expiry** — the boundary band is where money is lost and models are least reliable.

---

## Repository layout

Two trees. Only the first is ever a git repo.

```
/Users/nabeelahmed/AgenticAI/MUST/        ← PUBLIC repo, deliverables only
/Users/nabeelahmed/AgenticAI/MUST-work/   ← NOT a repo. Never committed. Never a subdir of MUST.
```

`MUST-work/` holds raw research, draft prose, the screen recording, scratch prompt experiments,
and anything carrying real or employer data.

```
MUST/
├── README.md              # what it is, 60-second quickstart, live demo + video links
├── LICENSE                # MIT
├── .gitignore  .env.example  scripts/pre-commit
├── docs/
│   ├── case-study.md      # ≤8 pages, handoff folded in as its final section
│   ├── ai-tool-use.md     # ≤1 page: tools, material prompts, verification, limitations
│   ├── warranty-policy.md # the 2-page spec the rules engine implements
│   └── process/d1..d5.md  # daily notes — raw material for the case study
├── src/
│   ├── agent/             # extract · retrieve · decide · draft · gate · pipeline · contracts(zod)
│   ├── llm/               # Gemini client + content-addressed fixture cache
│   └── data/              # seeded registry generator + ScenarioSpec → prose realizer
├── app/                   # Next.js: intake → triage/review → dispatch
├── eval/
│   ├── cases/             # frozen JSONL, labels authored before prose
│   ├── run.ts             # CLI harness; exits 1 on any RED gate
│   └── results/           # committed scorecards (markdown + json)
└── fixtures/              # cached LLM responses → grader runs everything with no API key
```

The UI and the eval harness both call the identical `runPipeline(input, deps)`; they differ only
in the `deps` they construct (`{ llm, registry, clock, config }`). **That is the reproducibility
claim** — nothing is demonstrable in the UI that the harness cannot exercise headlessly.

---

## Evaluation design

**Frozen clock.** `clock.now()` is injected and pinned to `2026-06-01T00:00:00Z` in every eval run.
Warranty math depends on "now"; without this the suite silently drifts and boundary cases flip
months later. This is the single highest-probability bug in the design — build it on day one.

**Labels before text.** Never hand-label 60 cases. Instead: (1) write `docs/warranty-policy.md`
first; (2) sample a structured `ScenarioSpec` — `{ assetId, warrantyState, faultCode, safetyTruth,
intendedRoute }`; (3) use an LLM **only as a one-way surface realizer** to render the spec into
messy manager prose under a style directive, never showing it the label fields. Extraction and
resolution ground truth then come free and independently from the spec.

> Honest caveat to state up front in the case study: decision ground truth derived from the rules
> is tautological with respect to those rules — it measures whether the *pipeline* feeds the rules
> correctly, not whether the *rules* are right. Rule correctness is validated separately by a
> **25-minute, 40-case hand audit against the policy document**, reported as a distinct number.
> Separating "rule correctness" from "pipeline correctness" is itself a limitations-section win.

**Case set: 60, floor 36.** 35 normal · 17 edge (ambiguous reference, warranty boundary dates,
buried/hedged safety language, multi-asset, typos and ES/EN code-switch, correct answer is
`NO_ACTION`) · 8 failure (asset not in registry, self-contradictory, prompt injection, garbage).
Registry is generator-produced (seed pinned, SHA-256 printed in every report) with 2–4 same-class
units per store — that is what manufactures ambiguity. Warranty states are **deliberately
unrealistic**: ~12% sit within ±14 days of expiry, over-sampled roughly 6× versus reality, because
that band is where the money leaks.

**Metrics**, with `npm run eval` exiting 1 on any RED:

| | Metric | Target |
|---|---|---|
| E1 | Asset resolution: correct / wrong / abstained | wrong ≤ 2% (RED > 3%) |
| E2 | Symptom micro-F1; severity exact | ≥ 0.85; ≥ 0.75 |
| E3 | Routing accuracy + confusion matrix | ≥ 90%; cell `warranty→vendor` = 0 |
| E4 | **Warranty leakage** — of gold-warranty cases, % **auto-routed** to a paid vendor | ≤ 0.5% (RED > 1%) |
| E5 | **Safety recall** | **1.00, build-breaking.** Precision ≥ 0.60 accepted |
| E6 | Escalation recall / precision / autonomy | ≥ 0.95 / ≥ 0.50 / ≥ 65% |
| E7 | Cost + p95 latency | ≤ $0.002 per report; **p95 ≤ 4 s** (measured 1.2 s/call on flash-lite low) |
| E8 | Flip rate across 3 live runs | ≤ 2% |

E4's denominator matters and must be stated: **gated cases are not leakage** — a human saw them.
Leakage is only what the system let through unsupervised. Conflating the two voids the metric.

**Two exhibits carry the AI-logic and evaluation blocks. Neither is cuttable:**

1. **The ablation.** Swap the rules engine for an LLM-decides-warranty variant and run the same 60
   cases. Expect leakage of roughly 12–18% versus ~0% for rules. This converts "we used AI
   appropriately" from an assertion into a measured double-digit gap. Cost: swapping one function.
2. **The τ sweep.** Sweep the gate threshold across [0,1] and plot leakage, safety false negatives
   and human review load against autonomy. Then set τ\* as the *minimum* τ holding leakage ≤ 0.5%
   and safety FN = 0 subject to review load ≤ 35%. Ships as the "cost of autonomy" curve — proof
   the threshold was measured, not guessed. Cost: a loop over results you already have.

**Baselines — two computed, one measured.** (a) *Null:* "always dispatch a vendor," what
understaffed chains actually do; its leakage rate is the ROI denominator. (b) *Keyword:* regex +
lookup, no LLM — tests whether the model earns its cost. If it wins on the 35 normal cases and
loses only on the messy ones, **say so**; "the LLM buys you the 30% of reports that are messy, and
nothing else" is a more credible finding than a uniform win. (c) *Human proxy:* you, stopwatch
running, 15 reports against a searchable registry table. Report median seconds-to-decision,
explicitly labeled indicative at n=15. Do not simulate a human with an LLM and call it a baseline.

**Determinism.** `temperature: 0`, `topK: 1`, pinned model version, versioned prompt strings, and a
**content-addressed fixture cache** keyed on
`sha256(modelId + promptVersion + request + generationConfig)`. Three modes via `EVAL_MODE`:
`replay` (default, no network, a cache miss is a hard error rather than a silent API call),
`record`, `live`. Then **measure the residual** — publish the E8 flip rate rather than claiming
determinism you have not demonstrated.

**Bias probes — paired design, same `ScenarioSpec`, varied surface.** Two axes only, given the
budget: language/dialect (standard EN vs ES/EN code-switch vs SMS shorthand) and emotion
(angry vs polite, identical fault). A finding like "+15pp escalation for code-switched reports"
means non-native-speaking managers get slower service — a real, quantified, fixable harm. Every
claim in the case study cites a case ID, a trace file and a number.

---

## Public-repo hygiene

1. **Physical separation.** Working material lives in `MUST-work/`, a sibling directory, so
   `git add .` from inside the repo cannot reach it. The common accident becomes structurally
   impossible rather than merely discouraged.
2. **`.gitignore`**: `.env*` (with `!.env.example`), `node_modules/`, `.next/`, `*.mp4`, `*.mov`,
   `*.key`, `*.pem`, `.DS_Store`, `_work/`.
3. **Pre-commit hook** — committed at `scripts/pre-commit` and installed into `.git/hooks/` —
   blocking any staged file that matches a key pattern (`AIza[0-9A-Za-z_-]{35}`, `sk-ant-`,
   `gh[pousr]_`), is named `.env`, or exceeds 5 MB.
4. **No real data, ever.** Registry, vendors and reports are wholly synthetic and generated by a
   committed script — reproducible, and carrying no third-party or employer information.
5. **Demo video** goes to Loom; only the link enters the README. The source recording stays in
   `MUST-work/`.
6. **Public from the first commit**, so the history proves nothing predated the sprint.
7. **Rotate the key after submission.** The working key was pasted into a chat transcript, so treat
   it as disclosed: it is fine for the sprint, but revoke it at `aistudio.google.com/apikey` once
   the deliverables are in. It must never appear in a commit, a fixture file, a screenshot, or the
   demo video — check the video frames for a visible terminal before uploading.

---

## Day plan — 40.0 hours

The cap is on **effort (40h), not wall-clock**, so "Day 1" means your first 8-hour block, starting
whenever you start. Log hours as you go in `docs/process/` — the 40h cap is itself a constraint the
grader is watching you respect, and a truthful hour log is a cheap credibility signal.

The recruiter's rhythm is an **artifact delivery schedule, not a work schedule**. Taken literally
it fails: the locked scope is ~13h of build, not 8; a gold set authored on Day 4 is a post-hoc
rationalization that cannot influence the product; and a first Vercel deploy on Day 5 is how
sprints die. Each day below still emits its prescribed artifact — the work behind it just refuses
to serialize where feedback loops exist.

### Day 1 — Problem, baseline, gold set, spine (8.0h)
- **1.5** Persona + as-is workflow, 8 steps with **minutes per step** (intake 2m, asset lookup 4m, warranty check 5m, vendor/SLA 3m, WO creation 4m…)
- **1.0** Baseline $ model with 6 named assumptions — e.g. 80 stores × 4.2 breakdowns/yr = 336 tickets; 18% in-warranty; 35% of those leak; × $780 avg = **~$16.5k/yr leakage**, plus 22 min avg time-to-dispatch
- **1.0** Scope, exclusions, and a **decision-rights table** (agent decides / agent drafts / human approves / human owns)
- **2.5** `docs/warranty-policy.md` (2pp) + `ScenarioSpec` schema + **40 labeled specs** — ground truth written before any prompt exists
- **1.5** Repo init, Next.js + TS scaffold, folder layout, push, Vercel connected, hello-world live
- **0.5** `docs/process/d1.md`

### Day 2 — Design artifacts + agent core, part 1 (8.0h)
- **1.0** To-be journey + service blueprint with front-stage / back-stage / manual-ops lanes. **Mermaid or Excalidraw. Do not open Figma.**
- **1.0** Wireframes, 4 screens max, low fidelity — a photographed hand sketch is acceptable and often reads better
- **1.0** Value model: primary metric (**warranty-leakage catch rate**) + 2 guardrails (false-claim rate, escalation rate)
- **1.0** Operating model — people, data, systems, manual ops; what breaks at 120 stores; the **cost-of-error asymmetry table**
- **3.5** Build: zod contracts, injected `Clock`, seeded registry generator, fixture cache, **LLM client with rate limiter + 429/503 backoff**, EXTRACT + RETRIEVE
- **0.5** `docs/process/d2.md`

### Day 3 — Prototype complete (8.0h)
- **3.0** DECIDE rules engine + routing table + DRAFT + groundedness checker + GATE
- **2.5** UI, 3 screens wired via server actions. **Ugly is fine.**
- **1.5** CLI eval harness: runs the case set, emits JSON + markdown scorecard, gate table, exit code
- **1.0** Real Vercel deploy; **verify replay mode with `GOOGLE_API_KEY` unset**

### Day 4 — Evaluation (8.0h)
- **1.0** Expand 40 → 60 specs; realize prose; freeze JSONL with SHA
- **2.0** v1 run + **the ablation** + hallucination/injection probes; capture 5 verbatim failures
- **2.0** **Exactly two** improvement iterations, re-scored; v2 scorecard
- **1.0** τ sweep + the two computed baselines + the timed human proxy
- **1.5** Bias probes (2 axes), risk register, what you would not ship
- **0.5** Commit `eval/results/REPORT.md`

### Day 5 — Communication (8.0h)
- **3.0** Case study, 8pp — **edited down from the process notes, not written from blank**
- **1.0** Handoff section (inside the 8 pages) + `ai-tool-use.md` + prior-work disclosure
- **1.0** 60-day validation plan with proceed / iterate / stop thresholds
- **2.0** Video: script 0.5, record 0.75 (3 takes max), trim 0.75
- **0.5** README quickstart + fresh-clone smoke test of both modes
- **0.5** Buffer

**Daily process notes are deliverables, not theatre.** Day 5 allocates 3h to ~3,600 words. From a
blank page that is where these sprints die; as an edit pass over four days of notes it is a 3h job.
Cap them at 30 min/day, bullets and one diagram, zero formatting.

---

## Pre-committed cut list

Cut strictly top-down the moment you are >90 minutes behind. Decide now, not at 11pm on Day 3.

| # | Cut | Saves |
|---|---|---|
| 1 | Bias analysis → 6-case probe + an honest "here is the test I'd run at n=500" paragraph | 1.0h |
| 2 | Dispatch-confirmation screen → terminal-state banner on the Review screen (3 screens → 2) | 1.5h |
| 3 | LLM-written vendor email → deterministic template with one LLM-written symptom line | 1.5h |
| 4 | Second improvement iteration → ship v1→v2 only; document v3 as "next" | 1.5h |
| 5 | Vercel deploy → local + video (the README must then be flawless) | 1.5h |
| 6 | Service blueprint → journey map with inline back-stage annotations | 1.0h |
| 7 | Case set 60 → 36. **Hard floor: 36.** | 1.0h |

**Never cuttable — the graded spine:** all five pipeline stages exist (GATE is ~40 minutes and is
the clearest evidence of AI operating judgment in the whole build) · the case set + harness + a
**v1→v2 scorecard with real numbers** · the ablation · the human-vs-agent baseline table (it alone
carries much of Business 15% and Evaluation 15%) · the minute-level as-is workflow · the
warranty-leakage $ model · **offline fixture mode** (if a grader without a key cannot run it, the
prototype scores near zero regardless of quality) · the 8-page and 5-minute caps, which are
pass/fail judgment signals on a test of judgment.

**Top failure modes, pre-empted:** UI overbuild (p≈0.65) — 3 routes, no auth, no database, no
responsive work below 1024px, one 20-minute styling pass on Day 5, and never before. Eval written
after the build (p≈0.55) — rule: *the first prompt you write is scored within 60 minutes of being
written*. Synthetic data too clean (p≈0.70) — the difficulty ladder and the 6× over-sampled
warranty boundary band above. Blowing a stated cap (p≈0.50) — write the per-section word budget on
Day 2; 8pp with figures ≈ 3,600 words, 5 minutes ≈ 700 spoken words, script the video and read it.
Prompt rabbit-holing (p≈0.45) — **2 scored revisions per stage, then stop**; anything still failing
becomes a documented remaining risk, which is worth more rubric points than silently fixing it.

**Where marginal hours pay best**, in order: the cost-of-error asymmetry + decision-rights tables
(false "in warranty" = rejected claim and 6 days of downtime; false "out of warranty" = you pay
$780 you did not owe — then show τ\* was set *from* that asymmetry) → the minute-level as-is
workflow plus how you would instrument leakage at the customer in week 1 → the v1→v2 delta as a
defended tradeoff ("safety recall 0.71 → 0.94 after adding the lexicon; escalation rose 12% → 19%,
which we accept because a missed gas-smell costs more than 7 extra reviews") → a second video take
opening on the dollar number, never on "Hi, I'm…" → last, any UI work beyond functional.

---

## 60-day validation plan (drafted Day 5, sketched Day 1)

**Rollout:** days 1–14 **shadow** (runs on everything, coordinator sees nothing) · days 15–45
**assist** (recommendation shown, one-click accept/override, override requires a reason code from a
fixed 8-item taxonomy — that single click is the entire feedback loop) · days 46–60 **limited
autonomy** (auto-dispatch only when confidence ≥ τ\*, cost < $500, no safety flag).

**Leakage is not the primary metric, and the plan must say why.** 100 stores × 2.5 reports/month ×
2 months ≈ 500 reports, ~30% warranty-eligible = **150 events**; detecting 18% → 8% at 80% power
needs ≈181 per arm, so it is **underpowered**. Worse, invoices arrive 30–45 days after the job, so
a day-60 read sees ~55% of relevant invoices, biased toward fast-invoicing vendors.

**Primary = warranty-determination compliance:** % of dispatched warranty-eligible jobs carrying a
recorded, coordinator-confirmed-correct verdict at dispatch. It is the causal mechanism, it fires
on all 150 events, and it is readable in real time. Leakage becomes the **lagging confirmatory
metric read at day 90**. For an early directional read, log every shadow-phase case where the
system said COVERED and the coordinator paid — a **"would-have-leaked" near-miss** with a dollar
value, available from day 14.

- **PROCEED** — all of: determination coverage ≥ 95%, verdict agreement ≥ 90%, **safety FN = 0**,
  time-to-dispatch −30%, override ≤ 20%, autonomy ≥ 50%, leakage point estimate ≤ 10% with upper
  95% bound ≤ 14%.
- **ITERATE** (extend 30 days, narrow to the top-2 override reason codes) — safety FN = 0 **and**
  any of: agreement 75–90%, override 20–35%, leakage 10–15%.
- **STOP** — any of: one safety false negative reaching dispatch; leakage CI includes zero
  improvement with point estimate ≥ baseline − 2pp; override > 40% at day 45; time-to-dispatch flat
  or worse; any single incident > $10k attributable to an auto decision.

**The confound that matters most:** deploying this forces someone to clean the asset registry, so
the gain may come from clean data rather than from AI. Mitigation — freeze a day-0 registry
snapshot, log every edit, and re-score all assisted decisions against the day-0 snapshot. If the
gain does not survive, the honest recommendation is "buy a data-cleanup project, not an AI
product" — and writing that down scores better than the pilot passing. Also pre-empt: invoice lag,
seasonality (concurrent 20-store holdout, never pre/post alone), Hawthorne contamination in the
holdout, and selection bias (the shadow phase covers 100% of intake by construction).

**Cost framing:** measured ~250 tokens/report across both LLM calls at `thinkingLevel: "low"`,
≈ **$0.0002** at published flash-lite list price (recompute at write-up time). One prevented claim
(~$1,200) pays for ~400,000 reports. Inference cost is not a decision variable here; **escalation
labor is** — which is why the τ sweep, not the model choice, is the economic lever.

---

## Verification

Run at the end of Day 3, and again as the final Day 5 gate:

1. **Grader simulation — the one that matters.** `git clone` the public repo into a temp dir with
   `GOOGLE_API_KEY` unset, then `npm ci && npm run eval`. Must complete offline from fixtures,
   print the scorecard, and exit 0. Then `npm run dev` and walk intake → review → dispatch.
2. **Live mode.** With a valid key: `EVAL_MODE=live npm run eval -- --repeat 3` → publishes the E8
   flip rate and real latency/cost figures.
3. **Red gates fire.** Deliberately corrupt one safety label; confirm `npm run eval` exits 1.
4. **Determinism.** Two consecutive `replay` runs produce byte-identical scorecards.
5. **Clock is frozen.** Change the system date by a year; the scorecard must not move.
6. **Secret scan.** `git log -p | grep -nE 'AIza[0-9A-Za-z_-]{35}|sk-ant-|gh[pousr]_'` → zero hits.
   Confirm the pre-commit hook rejects a staged dummy key and a 6 MB file.
7. **Caps.** Case study word count ≤ ~3,600; `ai-tool-use.md` ≤ 1 page; video duration ≤ 5:00.
8. **Repo contains only deliverables.** `git ls-files` reviewed line by line — every entry is
   prototype, docs, eval, or config. Nothing from `MUST-work/` appears.
