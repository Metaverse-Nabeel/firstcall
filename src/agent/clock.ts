import type { Clock } from "./contracts";

/**
 * Every eval run is pinned here. Warranty math is date arithmetic against "now", so a
 * live clock makes boundary cases flip months after they were authored — the suite would
 * pass today and fail in November for reasons unrelated to any code change.
 *
 * Changing this value invalidates every committed fixture and scorecard. Don't.
 */
export const EVAL_EPOCH = "2026-06-01T00:00:00Z";

export function frozenClock(iso: string = EVAL_EPOCH): Clock {
  const fixed = new Date(iso);
  if (Number.isNaN(fixed.getTime())) throw new Error(`frozenClock: invalid ISO date ${iso}`);
  return { now: () => new Date(fixed) };
}

/** Production only. The eval harness must never construct this. */
export function systemClock(): Clock {
  return { now: () => new Date() };
}
