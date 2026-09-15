---
name: deliverable-caps
description: Enforce the recruiter's hard length caps on the case study (8 pages), AI tool-use note (1 page), and demo video (5 minutes). Use when drafting, editing, or declaring done any document or the video script.
---

# Deliverable caps

The caps are **pass/fail judgment signals on a test of judgment**. Overrunning does not
cost a few style points — it demonstrates the exact failure the sprint is designed to
detect. Treat them as build gates.

| Deliverable | Cap | Working budget |
| --- | --- | --- |
| `docs/case-study.md` (handoff folded in as final section) | **8 pages** | ~3,600 words with figures |
| `docs/ai-tool-use.md` | **1 page** | ~450 words |
| Demo video | **5:00** | ~700 spoken words, scripted and read |
| Prior-work disclosure | short | a paragraph |

## Check, do not estimate

```bash
wc -w docs/case-study.md docs/ai-tool-use.md
```

Subtract nothing for code blocks and tables — they consume page space faster than prose,
not slower. If `wc -w` says 3,900, you are over, not "about right."

For the video, read the script aloud with a timer. Reading pace is ~140 wpm; silent
estimation is consistently 30% optimistic.

## Write the section budget on Day 2, not Day 5

Allocate words before drafting. A representative split for the 8 pages:

| Section | Words |
| --- | --- |
| Problem & user | 550 |
| Solution & UX | 550 |
| AI logic & why rules decide warranty | 700 |
| Evaluation & results | 800 |
| Business & operating judgment | 450 |
| Risks & what I would not ship | 300 |
| Handoff | 250 |

Enforce per section as you draft. A single section running 2x is how the whole document
ends at 12 pages with no obvious place to cut.

## Cutting

Cut **claims that cannot cite** a case ID, a trace file and a number. Do not cut numbers to
make room for prose — the numbers are the deliverable and the prose is the packaging.

Do not soften instead of cutting. A hedged paragraph costs the same page space as a
confident one and scores less.

## The Day 5 edit pass

3 hours for ~3,600 words is comfortable **as an edit pass over four days of process notes**
and near-impossible from a blank page. That is the entire reason `docs/process/dN.md` is
written daily and capped at 30 minutes — bullets and one diagram, zero formatting.

If Day 5 begins and the process notes are thin, the correct move is to cut scope from the
case study, not to try to write 3,600 words of original prose in 3 hours.

## Video

Open on the dollar number, never on "Hi, I'm…". Script it, read it, three takes maximum.
A second take that opens well is worth more than any amount of UI polish.

**Before uploading: check every frame for a visible terminal, API key, or file path
containing real data.**
