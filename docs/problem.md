# Problem, baseline and scope

The Day-1 discovery artifacts. The case study draws on these; they are kept separate so the
numbers have one home and cannot drift between documents.

---

## 1. The user

**Priya, facilities coordinator.** One of two coordinators covering 80 company-operated QSR
stores across three metros. Sits in a regional office, not in a store. Handles 25–40 inbound
breakdown reports a day, arriving by SMS, a ticket form, and a shared inbox.

She is not a technician and not a buyer. She is a **router** — her job is to get the right
person to the right box quickly, without spending money the company does not owe.

**What she is measured on:** time-to-dispatch, store downtime, and repair spend against
budget. Nobody measures her on warranty capture, which is precisely why it leaks.

---

## 2. As-is workflow

Timed against a coordinator's description of a routine ticket. Times are per report.

| # | Step | System | Minutes |
|---|---|---|---|
| 1 | Read the report, work out what broke | Inbox / SMS | 2 |
| 2 | Identify the specific unit (which of 3 fryers?) | Back-and-forth with the store | 4 |
| 3 | Look up the asset record | Asset spreadsheet | 4 |
| 4 | Check in-service date and warranty term | Same spreadsheet, different tab | 5 |
| 5 | Check whether the PM log is complete | Third-party PM portal | 3 |
| 6 | Pick a vendor covering that store and asset class | Vendor matrix | 3 |
| 7 | Raise the work order and send it | CMMS | 4 |
| 8 | Log the decision | CMMS notes | 1 |
| | **Total** | | **26 min** |

**Steps 2–6 are 19 of the 26 minutes and none of them require judgment.** They are lookups
and date arithmetic. Step 1 requires reading comprehension. Steps 7–8 are transcription.

That distribution is the entire product thesis: automate 2–6, leave 1 assisted, and never
touch the moment where money is committed.

**Where it actually breaks down.** Under load, step 4 is the one that gets skipped. It is
the slowest, it lives in a different tab, and skipping it has no immediate consequence —
the invoice arrives 30–45 days later, by which point nobody connects it to this ticket.

---

## 3. Baseline: what warranty leakage costs

Six named assumptions. Each is a number a customer could check in week 1, which matters
more than the total being right.

| # | Assumption | Value | Source of truth in a real deployment |
|---|---|---|---|
| A1 | Stores | 80 | Store master |
| A2 | Breakdown reports per store per year | 4.2 | CMMS ticket count / store count |
| A3 | Share of reports on an in-warranty asset | 18% | Asset register: in-service date + term |
| A4 | Share of those where warranty is missed and a vendor is paid | 35% | Invoices matched against the asset register |
| A5 | Average vendor invoice for a repair that was covered | $780 | AP line items by asset class |
| A6 | Average time-to-dispatch | 22 min | CMMS timestamps |

```
80 × 4.2            = 336 reports/yr
336 × 18%           = 60.5 in-warranty reports/yr
60.5 × 35%          = 21.2 leaked repairs/yr
21.2 × $780         ≈ $16,500/yr in avoidable spend
```

**≈ $16.5k/yr for an 80-store chain**, plus 336 × 26 min ≈ **146 coordinator-hours/yr** on
the lookup steps.

**Sensitivity.** A4 is the softest number and the one doing the most work. At 20% leakage the
figure is ~$9.4k; at 50% it is ~$23.6k. The honest framing for a customer is *"somewhere
between $9k and $24k, and the first thing we do in week 1 is measure which"* — not a
confident $16.5k.

**Why this is the right metric to lead with.** It is money the business already spends, it
is attributable to a single skipped step, and it is measurable from invoices the company
already has. Time saved is real but softer: 146 hours does not remove a headcount, so it
converts to capacity rather than cash.

---

## 4. Scope

**In scope.** Single-asset breakdown reports from store staff, for capital kitchen and
facilities assets, at company-operated stores. Triage through to a drafted work order.

**Explicitly out of scope, and why:**

| Excluded | Why |
|---|---|
| Actually dispatching to a vendor system | Integration work with no product learning in it |
| Franchise stores | Different warranty ownership entirely — a separate problem wearing the same clothes |
| Planned/PM work | Not triage; scheduled, not reactive |
| Multi-asset reports | Splitting one report into several work orders has billing consequences; gated to a human instead |
| Parts ordering, invoice reconciliation | Downstream of the decision this product makes |
| Learning from coordinator overrides | Override reason codes are collected for humans to read. There is no online training loop, and claiming one would be the easiest lie to tell in a demo. |

---

## 5. Decision rights

Which decisions the agent may make, which it may only propose, and which never leave a
person. This table is the product, more than any screen is.

| Decision | Agent decides | Agent drafts, human approves | Human owns |
|---|---|---|---|
| What broke (symptom extraction) | ✅ | | |
| Which unit it is | ✅ *when unambiguous* | when ambiguous | |
| Whether a hazard was reported | ✅ *recall-first* | | acting on it |
| Warranty verdict | ✅ *by rule, not by model* | | disputed claims |
| Severity | ✅ | | |
| File a manufacturer warranty claim | ✅ | | |
| **Pay a vendor** | **never** | ✅ | ✅ |
| Emergency dispatch | **never** | ✅ | ✅ |
| Repair-or-replace | **never** | | ✅ |
| Override any of the above | | | ✅ |

### The asymmetry this encodes

| Error | Cost |
|---|---|
| False "out of warranty" | ~$780 paid that was not owed |
| False "in warranty" | Rejected claim **plus** ~6 days additional downtime |
| Missed safety flag | Unbounded |
| Unnecessary escalation | ~4 minutes of coordinator time |

Escalation is three orders of magnitude cheaper than the errors it prevents. Every gate in
the system is set from that ratio rather than from a target autonomy rate — which is why
τ\* is chosen by sweep against these costs, not picked to look impressive.

**The consequence, stated plainly:** the two routes that spend money are the two the agent
may never take. A product that automated those would be more impressive in a demo and worse
in production, and the difference between those two things is most of what this sprint is
testing.
