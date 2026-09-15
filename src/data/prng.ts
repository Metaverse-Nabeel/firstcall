/**
 * mulberry32 — small, fast, deterministic. Seeded PRNG so the registry and case set are
 * byte-reproducible from a pinned seed; the resulting SHA-256 is printed in every report.
 * Not cryptographic, and does not need to be.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof mulberry32>;

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error("pick: empty array");
  return xs[Math.floor(rng() * xs.length)]!;
}

export function intBetween(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Shuffle a copy. Fisher-Yates, driven by the same seeded stream. */
export function shuffled<T>(rng: Rng, xs: readonly T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
