import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/app/deps";
import type { Route } from "@/src/agent/contracts";

const TONE: Record<string, string> = { AUTONOMOUS: "ok", REVIEW: "warn", ESCALATE: "stop" };

/**
 * The button names the action the route actually takes. "Approve and dispatch" on a
 * warranty claim or an escalation promises a dispatch that never happens.
 */
const APPROVE_LABEL: Record<Route, string> = {
  NO_ACTION:          "Confirm",
  IN_HOUSE_FIX:       "Approve in-house fix",
  WARRANTY_CLAIM:     "Approve claim",
  VENDOR_DISPATCH:    "Approve and dispatch",
  EMERGENCY_DISPATCH: "Approve and dispatch",
  ESCALATE_HUMAN:     "Acknowledge escalation",
};

export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getResult(decodeURIComponent(id));
  if (!r) notFound();

  const { extraction: ex, resolution: res, decision: d, draft, gate: g } = r;

  return (
    <>
      <h1>Review · <code>{r.reportId}</code></h1>

      <div className={`banner ${TONE[g.decision] ?? "warn"}`}>
        <strong>{g.decision}</strong> — {g.explanation}
      </div>

      <div className="grid">
        <section className="card">
          <h2>Asset</h2>
          {res.resolved ? (
            <dl>
              <dt>Unit</dt><dd><code>{res.resolved.assetTag}</code> · {res.resolved.type.replace(/_/g, " ").toLowerCase()}</dd>
              <dt>Make</dt><dd>{res.resolved.manufacturer} {res.resolved.model}</dd>
              <dt>Location</dt><dd>{res.resolved.location}</dd>
              <dt>In service</dt><dd>{res.resolved.inServiceDate} · {res.resolved.warrantyTermMonths}mo term</dd>
              <dt>Match margin</dt><dd>{res.topMargin.toFixed(3)} {res.ambiguous && <span className="tag warn">ambiguous</span>}</dd>
            </dl>
          ) : (
            <p className="muted">Not resolved{res.notInRegistry ? " — no matching asset in this store's registry." : "."}</p>
          )}
          {res.candidates.length > 1 && (
            <>
              <h3>Candidates</h3>
              <ul className="candidates">
                {res.candidates.map((c) => (
                  <li key={c.assetId}><code>{c.assetTag}</code> <span className="muted">{c.score.toFixed(3)} · {c.matchedOn.join(", ").toLowerCase()}</span></li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h2>Decision</h2>
          <dl>
            <dt>Warranty</dt><dd><span className={`tag ${d.warrantyVerdict === "COVERED" ? "ok" : "warn"}`}>{d.warrantyVerdict.replace(/_/g, " ")}</span></dd>
            <dt>Expires</dt><dd>{d.warrantyExpiresOn ?? "—"} {d.daysToWarrantyExpiry !== null && <span className="muted">({d.daysToWarrantyExpiry}d)</span>}</dd>
            <dt>Severity</dt><dd>{d.severity}</dd>
            <dt>Route</dt><dd><strong>{d.route.replace(/_/g, " ")}</strong></dd>
            <dt>Cost exposure</dt><dd>${d.costExposure.toLocaleString()}</dd>
            <dt>SLA</dt><dd>{d.slaDeadline?.replace("T", " ").replace(".000Z", "Z") ?? "—"}</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <h2>Why — audit trail</h2>
        <p className="muted">
          Every rule that fired, in order. This is what a manufacturer is shown when they
          dispute the claim.
        </p>
        <table>
          <thead><tr><th>Rule</th><th>Description</th><th>Evidence</th></tr></thead>
          <tbody>
            {d.rulesFired.map((rule, i) => (
              <tr key={i}><td><code>{rule.ruleId}</code></td><td>{rule.description}</td><td className="muted">{rule.evidence}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid">
        <section className="card">
          <h2>Extracted</h2>
          <p><span className="muted">Symptoms</span><br />{ex.symptomCodes.join(", ") || "none"}</p>
          <p><span className="muted">Safety</span><br />{ex.safetyIndicators.length ? <span className="tag stop">{ex.safetyIndicators.join(", ")}</span> : "none"}</p>
          {ex.severityEvidenceSpan && <p><span className="muted">Severity evidence</span><br /><em>&ldquo;{ex.severityEvidenceSpan}&rdquo;</em></p>}
        </section>

        <section className="card">
          <h2>Confidence</h2>
          <dl>
            <dt>EXTRACT</dt><dd>{ex.cExtract.toFixed(2)}{ex.usedLexiconFallback && <span className="tag warn">fallback</span>}</dd>
            <dt>RETRIEVE</dt><dd>{res.cResolve.toFixed(2)}</dd>
            <dt>DECIDE</dt><dd>{d.cDecide.toFixed(2)}</dd>
            <dt>DRAFT</dt><dd>{draft.cDraft.toFixed(2)}{draft.usedTemplateFallback && <span className="tag warn">template</span>}</dd>
            <dt>Overall</dt><dd><strong>{g.confidence.toFixed(2)}</strong> <span className="muted">= min, weakest is {g.weakestLink}</span></dd>
          </dl>
          {g.hardGates.length > 0 && <p><span className="muted">Hard gates</span><br />{g.hardGates.map((h) => <span key={h} className="tag stop">{h.replace(/_/g, " ")}</span>)}</p>}
        </section>
      </div>

      <section className="card">
        <h2>Work order</h2>
        {draft.usedTemplateFallback && (
          <div className="banner warn">
            Generated text failed the groundedness check{draft.groundednessViolations.length > 0 && <> ({draft.groundednessViolations.map((v) => v.token).join(", ")} not in the record)</>}; fell back to a template.
          </div>
        )}
        <p><span className="muted">Symptom summary</span><br />{draft.workOrder.symptomSummary}</p>
        <p><span className="muted">Vendor instructions</span><br />{draft.workOrder.vendorInstructions}</p>
      </section>

      <div className="actions">
        <Link href={`/dispatch/${encodeURIComponent(r.reportId)}`} className="button">
          {g.decision === "AUTONOMOUS" ? "Confirm" : APPROVE_LABEL[d.route]}
        </Link>
        <Link href="/" className="muted">Back to intake</Link>
      </div>
    </>
  );
}
