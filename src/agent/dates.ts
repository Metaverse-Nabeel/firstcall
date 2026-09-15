/** UTC calendar-date helpers. Every caller passes an injected clock's value, never Date.now(). */

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  const targetDay = d.getUTCDate();
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  // 31 Jan + 1 month is 28/29 Feb, not 2/3 March. Warranty terms are stated in months,
  // so day-of-month has to be clamped rather than allowed to roll over.
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(targetDay, lastDay));
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
  const b = Date.parse(toIso.length === 10 ? `${toIso}T00:00:00Z` : toIso);
  return Math.round((b - a) / 86400000);
}

export function addHours(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

export function isValidIsoDate(s: unknown): s is string {
  return typeof s === "string" && s.length >= 10 && !Number.isNaN(Date.parse(s));
}
