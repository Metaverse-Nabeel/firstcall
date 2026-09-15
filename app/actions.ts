"use server";

import { redirect } from "next/navigation";
import { runPipeline } from "@/src/agent/pipeline";
import { webDeps, putResult } from "./deps";
import type { BreakdownReport } from "@/src/agent/contracts";

export async function triageAction(formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  const storeId = String(formData.get("storeId") ?? "").trim();
  const reportId = String(formData.get("reportId") ?? "") || `WEB-${Date.now()}`;
  if (!text || !storeId) redirect("/?error=missing");

  const report: BreakdownReport = {
    reportId, storeId,
    reportedAt: "2026-06-01T09:00:00Z", // frozen with the eval clock so the demo matches the scorecard
    reporterRole: "STORE_MANAGER",
    text,
  };

  try {
    const result = await runPipeline(report, webDeps());
    putResult(result);
  } catch (e) {
    if ((e as Error).name === "FixtureMissError") redirect("/?error=fixture");
    throw e;
  }
  redirect(`/review/${encodeURIComponent(reportId)}`);
}
