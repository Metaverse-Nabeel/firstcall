# CLAUDE.md — working rules for this repo

**FirstCall** — an AI triage desk for multi-site facilities operations. Built as a
5-day / **40-hour hard-capped** solo product sprint. This file governs how work is done
here; `AGENT.md` specifies what the agent itself does.

---

## Four constraints that override everything else

1. **40 hours of effort, hard cap.** Not wall-clock. Every session appends to
   `docs/process/dN.md`. The cap is itself graded — a truthful hour log beats a
   flattering one. When >90 min behind, cut top-down from the cut list in
   `docs/plans/sprint-plan.md`; never silently descope the graded spine.
2. **The repo is public and holds deliverables only.** Prototype, docs, eval, config.
   Nothing else. See "Two-tree rule" below.
3. **The Gemini key is free-tier.** Requests/day is the binding constraint, not tokens.
   Never burn a live call the fixture cache could serve.
4. **55% of the grade is framing, judgment, evaluation and communication. 20% is the
   prototype.** Build is capped at ~13h. When tempted to polish the UI, go write the
   cost-of-error table instead.

---

## Two-tree rule

```
/Users/nabeelahmed/AgenticAI/MUST/        ← this repo. PUBLIC. Deliverables only.
/Users/nabeelahmed/AgenticAI/MUST-work/   ← NOT a repo. Never committed. Sibling, never a subdir.
```

Raw research, draft prose, screen recordings, scratch prompt experiments and anything
carrying real or employer data live in `MUST-work/`. The separation is physical so the
usual accident is structurally impossible rather than merely discouraged.

**Before any commit:** `git status --short` and read every line. If a file is not
prototype, docs, eval or config, it does not belong here. See the `repo-hygiene` skill.

---

## Model configuration — verified live, do not re-derive

- **Pinned: `gemini-3.5-flash-lite`, `thinkingLevel: "low"`, `temperature: 0`, `topK: 1`.**
  Measured 0 thought tokens, ~71 total tokens, 1.2 s on the real extraction task.
- **The model list lies.** `GET /v1beta/models` returns 41 models including the whole 2.5
  family, but a new free-tier key gets `404 … no longer available to new users` on most of
  them. Only call a model that has actually been called successfully here:
  `gemini-3.5-flash-lite` and `gemini-3.6-flash`.
- **Thinking is on by default and costs ~20x.** Default 3.6-flash spent 521 thought tokens
  on a 16-token prompt. Always set `thinkingConfig.thinkingLevel`.
- **Retry 429 AND 503.** The free tier returns `503 "currently experiencing high demand"`,
  not only rate-limit errors. Exponential backoff plus a client-side limiter, from the
  first commit.
- **Ablation fairness:** the LLM-decides-warranty variant runs on the *strongest* config
  (`gemini-3.6-flash`, `thinkingLevel: "high"`). Beating a deliberately weakened model is
  a strawman and a grader will notice.

**zsh gotcha:** `"…/models/$M:generateContent"` silently mangles the URL — `:g` parses as a
parameter modifier. Always write `${M}:generateContent`.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server — intake → review → dispatch |
| `npm run eval` | Full case set, replay mode, prints scorecard, **exits 1 on any RED gate** |
| `EVAL_MODE=record npm run eval` | Populate `fixtures/` from live API (spends quota) |
| `EVAL_MODE=live npm run eval -- --repeat 3` | Flip-rate (E8) and real latency/cost |
| `npm run gen:registry` | Regenerate the seeded synthetic asset registry |
| `npm run gen:cases` | Realize `ScenarioSpec`s into messy manager prose |
| `npm run check` | typecheck + lint + unit tests |

`EVAL_MODE` defaults to `replay`. **In replay a cache miss is a hard error**, never a
silent API call — that is what keeps the grader's keyless run honest.

---

## Architecture invariants

The UI and the eval harness both call the identical `runPipeline(input, deps)` and differ
only in the `deps` they construct (`{ llm, registry, clock, config }`). Nothing may be
demonstrable in the UI that the harness cannot exercise headlessly — that is the
reproducibility claim, and breaking it invalidates the evaluation section.

- **`clock.now()` is always injected**, never `Date.now()`. Pinned to
  `2026-06-01T00:00:00Z` in every eval run. Warranty math depends on "now"; without this
  the suite drifts and boundary cases flip months later.
- **Missing data is typed `UNKNOWN`, never defaulted.** A defaulted join is how warranty
  leakage happens.
- **The LLM never emits an `assetId`** — only descriptors. Resolution is deterministic.
- **The LLM never determines warranty.** See `AGENT.md` for why; it is the centrepiece of
  the case study's AI-logic section.

---

## Writing rules

Every claim in `docs/` cites a case ID, a trace file and a number. Prose that cannot cite
gets cut, not softened.

Caps are pass/fail judgment signals on a test of judgment:
`docs/case-study.md` ≤ 8 pages (~3,600 words incl. handoff section) ·
`docs/ai-tool-use.md` ≤ 1 page · demo video ≤ 5:00 (~700 spoken words).
Check with the `deliverable-caps` skill before declaring anything done.

Daily process notes are capped at **30 min/day** — bullets and one diagram, zero
formatting. They are raw material for the Day 5 edit pass, not finished prose.

---

## Prompt discipline

**Two scored revisions per pipeline stage, then stop.** Anything still failing becomes a
documented remaining risk in the case study, which scores better than silently fixing it.
The first prompt written must be scored within 60 minutes of being written — evaluation
written after the build is the most likely way this sprint fails.

---

## Secrets

`GOOGLE_API_KEY` lives in `.env.local` (gitignored) and nowhere else. It must never appear
in a commit, a fixture file, a screenshot, or the demo video — check video frames for a
visible terminal before uploading. The current key was pasted into a chat transcript, so
treat it as disclosed: **rotate it at aistudio.google.com/apikey after submission.**

The pre-commit hook at `scripts/pre-commit` blocks staged files matching
`AIza[0-9A-Za-z_-]{30,}`, `sk-ant-`, `gh[pousr]_`, named `.env`, or larger than 5 MB.
Install it with `npm run setup:hooks`. It is a backstop, not permission to be careless.
