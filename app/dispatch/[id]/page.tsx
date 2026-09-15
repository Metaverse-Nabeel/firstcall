import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/app/deps";

export default async function Dispatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getResult(decodeURIComponent(id));
  if (!r) notFound();
  const { decision: d, gate: g, draft } = r;
  const spends = d.route === "VENDOR_DISPATCH" || d.route === "EMERGENCY_DISPATCH";

  return (
    <>
      <h1>Dispatched · <code>{r.reportId}</code></h1>
      <div className="banner ok"><strong>{d.route.replace(/_/g, " ")}</strong> recorded for {draft.workOrder.assetTag} at {draft.workOrder.storeId}.</div>

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
          <dt>Vendor</dt><dd>{d.assignedVendorId ?? "— (manufacturer claim)"}</dd>
          <dt>SLA</dt><dd>{d.slaDeadline?.replace("T", " ").replace(".000Z", "Z") ?? "—"}</dd>
          <dt>Cost exposure</dt><dd>${d.costExposure.toLocaleString()}</dd>
          <dt>Decided by</dt><dd>{g.decision === "AUTONOMOUS" ? "agent, unsupervised" : "agent recommendation, human approved"}</dd>
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
