# Warranty & Routing Policy v1.0

The specification `src/agent/decide.ts` implements. Written **before** any prompt exists, so
that evaluation labels derive from policy rather than from observed model behaviour.

Every rule has an ID. When a decision is disputed, the audit trail cites these IDs —
*"W-12 and W-04 fired, in-service 2024-03-11, term 24mo, PM log complete"* — which is a
position you can take to a manufacturer. "The model thought so" is not.

---

## 1. Scope

Applies to capital kitchen and facilities assets at company-operated QSR stores. Excludes
leased equipment (vendor contract governs), IT/network hardware beyond the POS terminal,
and anything under an active service contract that supersedes manufacturer warranty.

**Required fields.** A verdict cannot be produced without all of: `inServiceDate`,
`warrantyTermMonths`, `pmLogComplete`, `type`, and the failure date. Any one missing or
`UNKNOWN` yields `UNKNOWN_MISSING_DATA` (W-03). **No field is ever defaulted** — a defaulted
join is the single most common cause of warranty leakage.

**Dates.** The failure date is `report.reportedAt`, not the date of triage. All arithmetic
is UTC calendar months against the injected clock, never the system clock.

---

## 2. Coverage rules

| ID | Rule | Verdict |
| --- | --- | --- |
| W-01 | `expiry = inServiceDate + warrantyTermMonths` (calendar months, day-of-month preserved; clamped to month end) | — |
| W-02 | Failure date is `reportedAt`. A failure reported late is still dated when it occurred, if stated. | — |
| W-03 | Any required field missing or `UNKNOWN` | `UNKNOWN_MISSING_DATA` |
| W-04 | `warrantyTermMonths == 0` (asset sold without warranty) | `NOT_COVERED` |
| W-05 | `failureDate > expiry + 30d` | `EXPIRED` |
| W-06 | `failureDate < expiry − 30d` and PM satisfied | `COVERED` |
| W-07 | `abs(failureDate − expiry) ≤ 30d` | `BOUNDARY_REVIEW` |
| W-08 | `pmLogComplete == false` **and** asset class requires PM (§3) | `VOIDED_NO_PM` |
| W-09 | `pmLogComplete == null` (log itself missing) | `UNKNOWN_MISSING_DATA` |
| W-10 | Fault is a listed wear/consumable item (§4) | `NOT_COVERED` |
| W-11 | Abuse, misuse or unauthorised modification indicated | **Never decided automatically** → human |
| W-12 | Otherwise, inside the window with PM satisfied | `COVERED` |

**W-07 is the money rule.** The ±30-day band around expiry is where claims are most often
both disputed and wrongly decided, and where a model is least reliable. Boundary cases are
**always gated to a human**, at any confidence, with the exact day count surfaced. The band
is deliberately wide: the cost of an unnecessary review (~4 min) is three orders of
magnitude below the cost of a wrong boundary call.

**Rule precedence.** W-03/W-09 (missing data) → W-11 (abuse) → W-07 (boundary) → W-08 (PM
void) → W-04/W-05 (outside) → W-10 (wear item) → W-06/W-12 (covered). Missing data
dominates everything: the system must never reason past a hole in the record.

---

## 3. PM requirement by asset class

Coverage is forfeited without a complete preventive-maintenance log for classes where the
manufacturer conditions warranty on servicing.

| PM required | PM not required |
| --- | --- |
| `WALK_IN_COOLER`, `REACH_IN_FREEZER`, `ICE_MACHINE`, `HVAC_RTU`, `HOOD_EXHAUST`, `FRYER` | `GRILL`, `DISHWASHER`, `COFFEE_BREWER`, `WATER_HEATER`, `PREP_TABLE`, `POS_TERMINAL` |

Refrigeration and gas/air-handling assets carry the PM condition because their failure
modes are service-sensitive; the rest do not. `FRYER` is included: filtration and boil-out
intervals are a standard warranty condition.

---

## 4. Wear and consumable exclusions (W-10)

Never covered regardless of window: door gaskets and seals, light bulbs and LED strips,
filters of all kinds, fryer baskets, grill plates and scrapers, water-filter cartridges,
drive belts, fuses. A fault whose **only** symptom is `DOOR_SEAL_FAIL` or `CLOGGED_DRAIN`
resolves to `NOT_COVERED` and routes to `IN_HOUSE_FIX`.

If a wear symptom appears **alongside** a non-wear symptom, W-10 does not fire — the
covered fault governs, and the wear item rides along on the same work order.

---

## 5. Routing decision table

Evaluated top-down; **first match wins**. `SAFETY` means any safety indicator raised by
either extractor.

| ID | Condition | Route | Autonomy |
| --- | --- | --- | --- |
| R-01 | `SAFETY` and severity `CRITICAL` | `EMERGENCY_DISPATCH` | **Human** |
| R-02 | `SAFETY`, any other severity | `ESCALATE_HUMAN` | **Human** |
| R-03 | Verdict `UNKNOWN_MISSING_DATA` | `ESCALATE_HUMAN` | **Human** |
| R-04 | Asset ambiguous or not in registry | `ESCALATE_HUMAN` | **Human** |
| R-05 | Multi-asset report | `ESCALATE_HUMAN` | **Human** |
| R-06 | Verdict `BOUNDARY_REVIEW` | `ESCALATE_HUMAN` | **Human** |
| R-07 | Abuse indicated (W-11) | `ESCALATE_HUMAN` | **Human** |
| R-08 | `costExposure > $2,500` | `ESCALATE_HUMAN` | **Human** |
| R-09 | Verdict `COVERED`, severity `CRITICAL` | `WARRANTY_CLAIM` (expedited) | Agent may draft |
| R-10 | Verdict `COVERED`, any other severity | `WARRANTY_CLAIM` | Agent may draft |
| R-11 | Verdict `VOIDED_NO_PM` | `ESCALATE_HUMAN` | **Human** — this is a $ decision |
| R-12 | `NOT_COVERED` by W-10, severity `LOW`/`MEDIUM` | `IN_HOUSE_FIX` | Agent may complete |
| R-13 | No actionable symptom (informational report) | `NO_ACTION` | Agent may complete |
| R-14 | `EXPIRED`/`NOT_COVERED`, severity `CRITICAL` | `EMERGENCY_DISPATCH` | **Human** |
| R-15 | `EXPIRED`/`NOT_COVERED`, any other severity | `VENDOR_DISPATCH` | **Human** |

### The autonomy column is the policy

**No row that spends money is ever autonomous.** `VENDOR_DISPATCH` and
`EMERGENCY_DISPATCH` — the only two routes that incur a bill — require a human at every
confidence level. There is no threshold that unlocks them and none will be added.

`WARRANTY_CLAIM` is autonomous-eligible in the opposite direction: filing a claim preserves
value and is reversible. Filing one wrongly costs a rejection letter; failing to file one
costs $780.

This is the asymmetric-authority principle expressed as a table: the agent may act freely
toward the cheap-to-be-wrong side and never toward the expensive one.

---

## 6. Cost exposure

```
costExposure = vendor.callOutFee + (vendor.hourlyRate × estimatedHours) + parts
```

`estimatedHours` is 2.0 by default, 4.0 for `HVAC_RTU` and `WALK_IN_COOLER`. Parts default
to `asset.typicalRepairCost`. When the computed exposure exceeds `asset.replacementCost ×
0.6`, the work order carries a **repair-or-replace** flag for the coordinator; the system
does not make that call.

## 7. SLA

`slaDeadline = reportedAt + vendor.slaHoursStandard`, or `slaHoursEmergency` for
`EMERGENCY_DISPATCH`. Where no vendor covers the store/type pair, the deadline is `null`
and the case escalates under R-04 — a missing vendor is missing data, not a reason to guess.

---

## 8. Known limitations

Stated here so they are stated in the case study too.

1. **Rules encode one chain's policy.** Term lengths and PM conditions vary by manufacturer
   and by negotiated contract; this version treats them as asset-class constants.
2. **No contract hierarchy.** Extended warranties, service contracts and manufacturer
   recalls all override manufacturer warranty in reality and are out of scope in v1.
3. **Ground truth derived from these rules is tautological with respect to them.** It
   measures whether the pipeline feeds the rules correctly, **not whether the rules are
   right.** Rule correctness is validated separately by a 40-case hand audit against this
   document and reported as a distinct number.
