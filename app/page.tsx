import { sampleReports } from "./deps";
import { triageAction } from "./actions";

export default async function Intake({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const samples = sampleReports();

  return (
    <>
      <h1>Triage intake</h1>
      <p className="muted">
        A store breakdown report goes in. A routed, warranty-checked work order comes out —
        or an explicit escalation saying why a person needs to look at it.
      </p>

      {error === "fixture" && (
        <div className="banner stop">
          <strong>No cached result for that text.</strong> This deployment runs in replay
          mode with no API key, so it can only triage the recorded reports below. That is
          the same constraint that lets the evaluation reproduce offline.
        </div>
      )}
      {error === "missing" && <div className="banner warn">Store and report text are both required.</div>}

      <form action={triageAction} className="card">
        <label htmlFor="storeId">Store</label>
        <input id="storeId" name="storeId" defaultValue={samples[0]?.storeId ?? "S-1000"} />
        <label htmlFor="text">Report</label>
        <textarea id="text" name="text" rows={4} defaultValue={samples[0]?.text ?? ""} />
        <button type="submit">Triage</button>
      </form>

      <h2>Recorded reports</h2>
      <p className="muted">The 60 evaluation cases. Each one runs the identical pipeline the scorecard measures.</p>
      <ul className="samples">
        {samples.map((s) => (
          <li key={s.reportId}>
            <form action={triageAction}>
              <input type="hidden" name="storeId" value={s.storeId} />
              <input type="hidden" name="text" value={s.text} />
              <input type="hidden" name="reportId" value={s.reportId} />
              <button type="submit" className="linkish">
                <code>{s.reportId}</code> <span className="muted">{s.label}</span>
                <span className="sample-text">{s.text.slice(0, 110)}{s.text.length > 110 ? "…" : ""}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
