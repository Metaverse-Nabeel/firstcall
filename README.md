# FirstCall

**AI triage desk for multi-site facilities operations.**

A facilities coordinator for 40–120 QSR stores receives free-text breakdown reports
("*Fryer 2 tripping the breaker, smells burnt, had to shut the line*") and, for each one,
manually looks up the asset, checks warranty, checks vendor SLA, then routes. FirstCall
automates the lookup-and-route step — and, more importantly, **refuses to automate the part
that costs money to get wrong.**

The money metric is **warranty leakage**: paying a vendor to repair an asset still under
manufacturer warranty. Baseline ≈ **$16.5k/yr** for an 80-store chain.

> Built as a 5-day, 40-hour-capped product sprint. Full reasoning in
> [`docs/case-study.md`](docs/case-study.md); the agent contract is in [`AGENT.md`](AGENT.md).

---

## Quickstart — no API key required

The default eval mode replays committed fixtures with **no network access**, so the whole
evaluation reproduces from a clean clone:

```bash
git clone https://github.com/Metaverse-Nabeel/firstcall.git
cd firstcall
npm ci
npm run eval        # prints the scorecard, exits 1 on any RED gate
npm run dev         # http://localhost:3000
```

A fixture cache miss in replay mode is a **hard error**, never a silent API call — that is
what makes this claim checkable rather than asserted.

To record new fixtures or measure live latency, copy `.env.example` to `.env.local`, add a
`GOOGLE_API_KEY`, and run `EVAL_MODE=record npm run eval`.

---

## The design in one table

Five stages. **Two are LLM, three are deterministic, and which is which is the whole point.**

| # | Stage | Impl | Why |
|---|---|---|---|
| 1 | EXTRACT | **LLM** | Messy human prose → structured descriptors. **Never emits an `assetId`.** |
| 2 | RETRIEVE | deterministic | Scores registry candidates. Ambiguity becomes a gate, not a guess. |
| 3 | DECIDE | deterministic rules | Warranty is date arithmetic over structured fields — and a disputed financial claim. |
| 4 | DRAFT | **LLM, prose only** | Two free-text fields, every numeral checked against the structured payload. |
| 5 | GATE | deterministic | `min(c_extract, c_resolve, c_decide, c_draft)` + hard gates that no score can buy past. |

**Governing principle — asymmetric authority.** The LLM may only move a decision toward the
*cheap-to-be-wrong* side: escalate to a human, or preserve a warranty claim. It can never
move one toward the expensive side — pay a vendor, void coverage, lower a severity.

**Why warranty determination is not the LLM** — it is the money metric, so behind a
stochastic function it becomes unimprovable by engineering; and when a manufacturer
disputes the claim, the audit trail must read *"rules W-12, W-04 fired, in-service
2024-03-11, term 24mo, PM log complete."* "The model thought so" is not a position.

This is measured, not asserted: the [ablation](eval/results/) swaps in an
LLM-decides-warranty variant on a *stronger* model and reports the leakage gap.

---

## Layout

```
src/agent/   extract · retrieve · decide · draft · gate · pipeline · contracts (zod)
src/llm/     Gemini client + content-addressed fixture cache
src/data/    seeded registry generator + ScenarioSpec → prose realizer
app/         Next.js: intake → review → dispatch
eval/        frozen case set, CLI harness, committed scorecards
docs/        case study, AI & tool-use note, warranty policy, daily process notes
```

The UI and the eval harness call the **identical** `runPipeline(input, deps)` and differ
only in the `deps` they construct. Nothing is demonstrable in the UI that the harness
cannot exercise headlessly.

## Data

All data is **synthetic** and produced by committed generators (`npm run gen:registry`,
`npm run gen:cases`) from a pinned seed whose SHA-256 is printed in every report. No real
or employer data appears anywhere in this repository.

## License

MIT — see [LICENSE](LICENSE).
