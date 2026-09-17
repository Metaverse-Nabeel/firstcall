import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/app/deps";
import type { Route } from "@/src/agent/contracts";

/**
 * A terminal screen is named for what actually happened. Calling an escalation
 * "Dispatched" claims the system committed work it deliberately refused to commit —
 * which is the exact opposite of the guarantee the route encodes.
 */
const TERMINAL: Record<Route, { title: string; tone: "ok" | "warn" }> = {
  NO_ACTION:          { title: "Closed · no action",   tone: "ok" },
  IN_HOUSE_FIX:       { title: "Assigned in-house",    tone: "ok" },
  WARRANTY_CLAIM:     { title: "Claim filed",          tone: "ok" },
  VENDOR_DISPATCH:    { title: "Dispatched",           tone: "ok" },
  EMERGENCY_DISPATCH: { title: "Dispatched",           tone: "ok" },
  ESCALATE_HUMAN:     { title: "Escalated",            tone: "warn" },
};

export default async function Dispatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getResult(decodeURIComponent(id));
  if (!r) notFound();
  const { decision: d, gate: g, draft } = r;
  const spends = d.route === "VENDOR_DISPATCH" || d.route === "EMERGENCY_DISPATCH";
  const escalated = d.route === "ESCALATE_HUMAN";
  const term = TERMINAL[d.route];

  // An escalation has no decision to approve — the decision is that a person must make one.
  const decidedBy = g.decision === "AUTONOMOUS"
    ? "agent, unsupervised"
    : escalated
      ? "agent escalated · awaiting a coordinator decision"
      : "agent recommendation, human approved";

  return (
    <>
      <h1>{term.title} · <code>{r.reportId}</code></h1>
      <div className={`banner ${term.tone}`}>
        <strong>{d.route.replace(/_/g, " ")}</strong> recorded for {draft.workOrder.assetTag} at {draft.workOrder.storeId}.
      </div>

      {escalated && (
        <div className="banner warn">
          No work was ordered and no spend was committed. The agent routed this to a person
          and stopped — that is the terminal state, not a step on the way to a dispatch.
        </div>
      )}

      {spends && (
        <div className="banner warn">
          This route commits spend, so it required a person. It is never issued
          automatically at any confidence — see <code>docs/warranty-policy.md</code> §5.
        </div>
      )}

      <section className="card">
        <dl>
          <dt>Work order</dt><dd><code>{draft.workOrder.workOrderId}</code></dd>
          <dt>Warranty</dt><dd>{d.warrantyVerdict.replace(/_/g, " ")}</dd>
          <dt>Vendor</dt><dd>{d.assignedVendorId ?? (escalated ? "— (none assigned)" : "— (manufacturer claim)")}</dd>
          <dt>SLA</dt><dd>{d.slaDeadline?.replace("T", " ").replace(".000Z", "Z") ?? "—"}</dd>
          <dt>{escalated ? "Cost at risk" : "Cost exposure"}</dt><dd>${d.costExposure.toLocaleString()}</dd>
          <dt>Decided by</dt><dd>{decidedBy}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Trace</h2>
        <dl>
          <dt>Model</dt><dd><code>{r.trace.modelId}</code></dd>
          <dt>Prompts</dt><dd>{Object.entries(r.trace.promptVersions).map(([k, v]) => `${k}=${v}`).join(" · ")}</dd>
          <dt>Clock</dt><dd>{r.trace.clockNow} <span className="muted">(frozen)</span></dd>
          <dt>Registry</dt><dd><code>{r.trace.registrySha256.slice(0, 16)}…</code></dd>
          <dt>LLM calls</dt><dd>{r.trace.llmCalls} ({r.trace.cacheHits} from cache)</dd>
          <dt>Latency</dt><dd>{r.trace.latencyMs} ms</dd>
        </dl>
      </section>

      <div className="actions"><Link href="/" className="button">New report</Link></div>
    </>
  );
}
