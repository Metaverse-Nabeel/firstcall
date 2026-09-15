/**
 * Seeded synthetic asset registry.
 *
 * Two properties matter more than realism:
 *
 *  1. **2-4 same-class units per store.** A store with one fryer makes RETRIEVE a no-op
 *     and the ambiguity metric a lie. Ambiguity has to be manufactured on purpose.
 *  2. **Expiry dates clustered around the eval epoch.** The +/-30d boundary band is where
 *     money leaks, so the registry must contain enough boundary assets for the case
 *     generator to over-sample them ~6x versus reality.
 *
 * No real or employer data appears here. Run: npm run gen:registry
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mulberry32, pick, intBetween, type Rng } from "./prng";
import { EVAL_EPOCH } from "../agent/clock";
import type { Asset, AssetType, Registry, Vendor } from "../agent/contracts";

export const REGISTRY_SEED = 20260601;
const OUT_PATH = resolve(process.cwd(), "eval/registry.json");

const STORE_COUNT = 12;

/** Per store: how many of each class, and whether the class conditions warranty on PM. */
const CLASS_PLAN: ReadonlyArray<{
  type: AssetType; min: number; max: number; pmRequired: boolean;
  makers: readonly string[]; models: readonly string[];
  replacement: [number, number]; repair: [number, number];
  locations: readonly string[]; tag: string;
}> = [
  { type: "FRYER", min: 2, max: 4, pmRequired: true,
    makers: ["Frymaster", "Pitco", "Henny Penny"], models: ["FPP-345", "SG14-S", "EVO-8000"],
    replacement: [7200, 11500], repair: [420, 1450],
    locations: ["front line", "back line"], tag: "FRY" },
  { type: "GRILL", min: 1, max: 3, pmRequired: false,
    makers: ["Garland", "Taylor"], models: ["ME-24", "L810"],
    replacement: [9000, 16000], repair: [500, 1900],
    locations: ["front line"], tag: "GRL" },
  { type: "REACH_IN_FREEZER", min: 2, max: 3, pmRequired: true,
    makers: ["True", "Traulsen"], models: ["T-49F", "G22010"],
    replacement: [4800, 8200], repair: [380, 1600],
    locations: ["back prep", "front line"], tag: "FRZ" },
  { type: "WALK_IN_COOLER", min: 1, max: 2, pmRequired: true,
    makers: ["Bally", "Kolpak"], models: ["WIC-810", "KF7-88"],
    replacement: [18000, 28000], repair: [900, 4200],
    locations: ["back of house"], tag: "WIC" },
  { type: "ICE_MACHINE", min: 1, max: 2, pmRequired: true,
    makers: ["Manitowoc", "Hoshizaki"], models: ["IYT0500A", "KM-660MAJ"],
    replacement: [4200, 7800], repair: [340, 1500],
    locations: ["back prep", "drive-thru"], tag: "ICE" },
  { type: "HVAC_RTU", min: 1, max: 2, pmRequired: true,
    makers: ["Carrier", "Trane"], models: ["48HC-07", "YSC072"],
    replacement: [14000, 24000], repair: [850, 5200],
    locations: ["roof"], tag: "RTU" },
  { type: "HOOD_EXHAUST", min: 1, max: 1, pmRequired: true,
    makers: ["CaptiveAire"], models: ["ND2-40"],
    replacement: [6500, 12000], repair: [400, 2100],
    locations: ["front line"], tag: "HOD" },
  { type: "DISHWASHER", min: 1, max: 1, pmRequired: false,
    makers: ["Hobart", "Jackson"], models: ["AM15", "TempStar"],
    replacement: [5200, 9000], repair: [300, 1300],
    locations: ["back prep"], tag: "DSH" },
  { type: "COFFEE_BREWER", min: 1, max: 2, pmRequired: false,
    makers: ["Bunn", "Curtis"], models: ["ICB-DV", "G4TP2S"],
    replacement: [1800, 3600], repair: [150, 600],
    locations: ["front counter"], tag: "BRW" },
  { type: "WATER_HEATER", min: 1, max: 1, pmRequired: false,
    makers: ["Rheem", "AO Smith"], models: ["G100-200", "BTH-199"],
    replacement: [3800, 7200], repair: [280, 1400],
    locations: ["back of house"], tag: "WTR" },
  { type: "POS_TERMINAL", min: 2, max: 3, pmRequired: false,
    makers: ["NCR", "Toast"], models: ["XR7", "TT-300"],
    replacement: [1400, 2600], repair: [120, 480],
    locations: ["front counter", "drive-thru"], tag: "POS" },
];

const WARRANTY_TERMS = [0, 12, 12, 24, 24, 24, 36, 36, 60] as const;

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const targetDay = d.getUTCDate();
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  // Clamp to month end — 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(targetDay, lastDay));
  return shifted.toISOString().slice(0, 10);
}

function daysBefore(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Choose an in-service date so this asset's expiry lands in a chosen band relative to the
 * eval epoch. Bands are what let the case generator over-sample the boundary.
 */
function inServiceForBand(rng: Rng, term: number, band: "BOUNDARY" | "INSIDE" | "OUTSIDE"): string {
  if (term === 0) return daysBefore(EVAL_EPOCH, intBetween(rng, 200, 1800));
  // offset = days from epoch to expiry. Negative = already expired.
  const offset =
    band === "BOUNDARY" ? intBetween(rng, -28, 28)
    : band === "INSIDE" ? intBetween(rng, 70, 900)
    : intBetween(rng, -1400, -70);
  const expiry = new Date(EVAL_EPOCH);
  expiry.setUTCDate(expiry.getUTCDate() + offset);
  // Walk back `term` months from the expiry to get the in-service date.
  return addMonths(expiry.toISOString().slice(0, 10), -term);
}

function buildVendors(rng: Rng, storeIds: string[]): Vendor[] {
  const specs: Array<{ name: string; types: AssetType[]; std: number; emer: number }> = [
    { name: "Northline Refrigeration", types: ["WALK_IN_COOLER", "REACH_IN_FREEZER", "ICE_MACHINE"], std: 24, emer: 4 },
    { name: "Apex Cooking Equipment", types: ["FRYER", "GRILL", "HOOD_EXHAUST"], std: 24, emer: 4 },
    { name: "Meridian Mechanical", types: ["HVAC_RTU", "WATER_HEATER"], std: 48, emer: 6 },
    { name: "Sterling Warewash", types: ["DISHWASHER", "COFFEE_BREWER"], std: 72, emer: 12 },
    { name: "Bluepoint IT Services", types: ["POS_TERMINAL"], std: 8, emer: 2 },
    { name: "Cardinal Facilities Group", types: ["FRYER", "GRILL", "DISHWASHER", "PREP_TABLE", "WATER_HEATER"], std: 36, emer: 6 },
  ];
  return specs.map((s, i) => ({
    vendorId: `V-${String(i + 1).padStart(3, "0")}`,
    name: s.name,
    coversTypes: s.types,
    // Deliberately partial coverage: some store/type pairs have no vendor, which must
    // escalate under R-04 rather than silently pick a substitute.
    coversStores: storeIds.filter(() => rng() > 0.12),
    slaHoursStandard: s.std,
    slaHoursEmergency: s.emer,
    callOutFee: intBetween(rng, 85, 240),
    hourlyRate: intBetween(rng, 95, 185),
  }));
}

export function generateRegistry(seed: number = REGISTRY_SEED): Registry {
  const rng = mulberry32(seed);
  const storeIds = Array.from({ length: STORE_COUNT }, (_, i) => `S-${String(1000 + i * 7).padStart(4, "0")}`);
  const assets: Asset[] = [];

  for (const storeId of storeIds) {
    for (const plan of CLASS_PLAN) {
      const n = intBetween(rng, plan.min, plan.max);
      for (let ordinal = 1; ordinal <= n; ordinal++) {
        const term = pick(rng, WARRANTY_TERMS);
        // ~22% boundary in the registry so the case generator can reach ~12% in the case
        // set without reusing the same handful of assets.
        const r = rng();
        const band = r < 0.22 ? "BOUNDARY" : r < 0.62 ? "INSIDE" : "OUTSIDE";
        const inServiceDate = inServiceForBand(rng, term, band);

        // pmLogComplete is null ~8% of the time — the log itself is missing, which is
        // UNKNOWN_MISSING_DATA (W-09), NOT the same as a known-incomplete log (W-08).
        const pmRoll = rng();
        const pmLogComplete = !plan.pmRequired ? true
          : pmRoll < 0.08 ? null
          : pmRoll < 0.26 ? false
          : true;

        assets.push({
          assetId: `A-${storeId.slice(2)}-${plan.tag}-${String(ordinal).padStart(2, "0")}`,
          storeId,
          assetTag: `${plan.tag}-${String(ordinal).padStart(2, "0")}`,
          type: plan.type,
          manufacturer: pick(rng, plan.makers),
          model: pick(rng, plan.models),
          serial: `${plan.tag}${intBetween(rng, 100000, 999999)}`,
          ordinal,
          location: pick(rng, plan.locations),
          inServiceDate,
          warrantyTermMonths: term,
          pmLogComplete,
          replacementCost: intBetween(rng, plan.replacement[0], plan.replacement[1]),
          typicalRepairCost: intBetween(rng, plan.repair[0], plan.repair[1]),
        });
      }
    }
  }

  const vendors = buildVendors(rng, storeIds);
  // Hash the content only — never the seed or the hash field itself.
  const sha256 = createHash("sha256")
    .update(JSON.stringify({ assets, vendors }))
    .digest("hex");

  return { seed, sha256, assets, vendors };
}

function main() {
  const registry = generateRegistry();
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(registry, null, 2) + "\n");

  const boundary = registry.assets.filter((a) => {
    if (a.warrantyTermMonths === 0) return false;
    const exp = new Date(addMonths(a.inServiceDate, a.warrantyTermMonths));
    const days = Math.round((exp.getTime() - new Date(EVAL_EPOCH).getTime()) / 86400000);
    return Math.abs(days) <= 30;
  }).length;

  console.log(`registry  -> ${OUT_PATH}`);
  console.log(`seed       ${registry.seed}`);
  console.log(`sha256     ${registry.sha256}`);
  console.log(`stores     ${new Set(registry.assets.map((a) => a.storeId)).size}`);
  console.log(`assets     ${registry.assets.length}`);
  console.log(`vendors    ${registry.vendors.length}`);
  console.log(`boundary   ${boundary} assets within +/-30d of expiry at ${EVAL_EPOCH.slice(0, 10)} (${(boundary / registry.assets.length * 100).toFixed(1)}%)`);
  console.log(`no-warranty ${registry.assets.filter((a) => a.warrantyTermMonths === 0).length}`);
  console.log(`pm null     ${registry.assets.filter((a) => a.pmLogComplete === null).length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
