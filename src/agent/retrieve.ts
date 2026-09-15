/**
 * Stage 2 — RETRIEVE. Deterministic. Turns descriptors into an asset, or refuses to.
 *
 * This stage exists so that the LLM never names an asset. Everything here is scoring
 * against the registry, so an injected instruction in the report text has nothing to act
 * on: the worst an attacker can do is push a descriptor toward a different candidate,
 * which shows up as a narrower topMargin and therefore as a gate.
 *
 * The bias is to abstain. An ambiguous resolution surfaces ranked candidates for a
 * one-click pick rather than guessing, because a wrong asset means a wrong warranty
 * verdict, and a wrong warranty verdict is the money.
 */
import type {
  Asset, AssetCandidate, AssetMention, ExtractionResult, Registry, ResolutionResult,
} from "./contracts";

/** Below this gap between #1 and #2, the match is not trustworthy enough to act on. */
const AMBIGUITY_MARGIN = 0.15;
/** Below this absolute score, we are pattern-matching noise rather than recognising an asset. */
const MIN_VIABLE_SCORE = 0.30;

const WEIGHTS = { TAG: 1.0, TYPE: 0.45, ORDINAL: 0.35, MODEL: 0.25, LOCATION: 0.15 } as const;
const MAX_SCORE = WEIGHTS.TAG + WEIGHTS.TYPE + WEIGHTS.ORDINAL + WEIGHTS.MODEL + WEIGHTS.LOCATION;

function scoreAsset(asset: Asset, mention: AssetMention): { score: number; matchedOn: AssetCandidate["matchedOn"] } {
  const matchedOn: AssetCandidate["matchedOn"] = [];
  let score = 0;
  const surface = mention.surfaceText.toLowerCase();

  // An explicit tag is near-decisive: the manager read it off the sticker.
  const tagPattern = new RegExp(`\\b${asset.assetTag.toLowerCase().replace("-", "[-\\s]?")}\\b`);
  if (tagPattern.test(surface)) { score += WEIGHTS.TAG; matchedOn.push("TAG"); }

  if (mention.type === asset.type) { score += WEIGHTS.TYPE; matchedOn.push("TYPE"); }

  if (mention.ordinalHint !== null && mention.ordinalHint === asset.ordinal) {
    score += WEIGHTS.ORDINAL; matchedOn.push("ORDINAL");
  }

  if (mention.modelHint) {
    const m = mention.modelHint.toLowerCase();
    if (asset.model.toLowerCase().includes(m) || asset.manufacturer.toLowerCase().includes(m)) {
      score += WEIGHTS.MODEL; matchedOn.push("MODEL");
    }
  }

  if (mention.locationHint) {
    const l = mention.locationHint.toLowerCase();
    if (asset.location.toLowerCase().includes(l) || l.includes(asset.location.toLowerCase())) {
      score += WEIGHTS.LOCATION; matchedOn.push("LOCATION");
    }
  }

  return { score: score / MAX_SCORE, matchedOn };
}

function resolveOne(mention: AssetMention, storeAssets: Asset[]): {
  best: Asset | null; candidates: AssetCandidate[]; topMargin: number;
} {
  const scored = storeAssets
    .map((a) => ({ asset: a, ...scoreAsset(a, mention) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const candidates: AssetCandidate[] = scored.slice(0, 5).map((s) => ({
    assetId: s.asset.assetId,
    assetTag: s.asset.assetTag,
    score: Number(s.score.toFixed(4)),
    matchedOn: s.matchedOn,
  }));

  if (scored.length === 0) return { best: null, candidates, topMargin: 0 };

  const top = scored[0]!;
  const second = scored[1];
  // With no runner-up the match is unopposed, which is the strongest possible margin.
  const topMargin = second ? Number((top.score - second.score).toFixed(4)) : top.score;

  if (top.score < MIN_VIABLE_SCORE) return { best: null, candidates, topMargin };
  return { best: top.asset, candidates, topMargin };
}

export function retrieve(extraction: ExtractionResult, report: { storeId: string }, registry: Registry): ResolutionResult {
  const storeAssets = registry.assets.filter((a) => a.storeId === report.storeId);

  // No store, or a store with no assets, is missing data — not a reason to search wider.
  if (storeAssets.length === 0) {
    return {
      resolved: null, candidates: [], topMargin: 0,
      ambiguous: false, notInRegistry: true, multiAsset: false, cResolve: 0,
    };
  }

  if (extraction.assetMentions.length === 0) {
    return {
      resolved: null, candidates: [], topMargin: 0,
      ambiguous: false, notInRegistry: true, multiAsset: false, cResolve: 0,
    };
  }

  const perMention = extraction.assetMentions.map((m) => resolveOne(m, storeAssets));
  const distinct = new Set(perMention.filter((r) => r.best).map((r) => r.best!.assetId));

  // Multi-asset reports are gated rather than split. Splitting one report into several
  // work orders is a product decision with billing consequences, not a parsing decision.
  const multiAsset = distinct.size > 1;

  const primary = perMention.find((r) => r.best) ?? perMention[0]!;
  const notInRegistry = !primary.best;
  const ambiguous = !!primary.best && primary.topMargin < AMBIGUITY_MARGIN;

  // cResolve saturates at the ambiguity margin: past it, a wider gap adds no information.
  const cResolve = notInRegistry ? 0 : Math.min(1, primary.topMargin / AMBIGUITY_MARGIN);

  return {
    resolved: primary.best,
    candidates: primary.candidates,
    topMargin: primary.topMargin,
    ambiguous,
    notInRegistry,
    multiAsset,
    cResolve: Number(cResolve.toFixed(4)),
  };
}
