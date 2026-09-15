/**
 * Deterministic extractor. Runs in PARALLEL with the LLM on every report, at zero extra
 * API cost, and earns its place twice:
 *
 *  1. **It computes c_extract.** Field-level agreement between two independent extractors
 *     is a real signal. Asking a model "are you confident?" returns a confidence-shaped
 *     token sequence, not a probability.
 *  2. **It is a second chance at safety recall.** safetyFlag is the OR of both extractors,
 *     so either one catching a gas smell is enough. Recall-first by construction; the
 *     precision cost is measured (E5) and published rather than tuned away.
 *
 * It is also the fallback when the LLM violates its schema twice.
 *
 * Patterns are deliberately broad. A false safety positive costs ~4 minutes of review.
 * A false negative costs an unbounded amount, so the asymmetry is priced in here.
 */
import type { SafetyIndicator, SymptomCode, AssetType, Severity } from "./contracts";

type Pat = { re: RegExp; code: string };

const SAFETY: ReadonlyArray<{ code: SafetyIndicator; re: RegExp }> = [
  { code: "GAS_SMELL", re: /\b(gas|propane|lpg|rotten egg|sulfur|sulphur)\b.{0,30}\b(smell|odou?r|leak|whiff)\b|\b(smell|odou?r|leak)\w*\b.{0,30}\b(gas|propane|lpg)\b|huele a gas/i },
  { code: "ELECTRICAL_ARCING", re: /\b(arc(ing|ed)?|spark(s|ing|ed)?|zap(ping)?|short(ed|ing)?\s*out|chispas)\b/i },
  { code: "SMOKE_OR_FIRE", re: /\b(smoke|smoking|smoulder|smolder|fire|flame|humo|fuego)\b/i },
  { code: "BURN_HAZARD", re: /\b(burn(t|ing|ed)?|scald(ed|ing)?|too hot to touch|quemad)\w*/i },
  { code: "EXPOSED_WIRING", re: /\b(bare|expos(ed|ing)|fray(ed|ing)|melted)\b.{0,20}\b(wire|wiring|cable|cord|insulation)\b|\bwire\w*\b.{0,20}\b(expos|bare|fray)\w*/i },
  { code: "CO_ALARM", re: /\b(carbon monoxide|co\s*(alarm|detector|monitor))\b/i },
  { code: "SLIP_HAZARD", re: /\b(slip(pery|ping)?|puddle|standing water|water (all )?over the floor|wet floor|piso mojado)\b/i },
  { code: "STRUCTURAL_HAZARD", re: /\b(ceiling|collaps(e|ed|ing)|sag(ging)?|falling|structural)\b/i },
  { code: "FOOD_SAFETY_TEMP_BREACH", re: /\b(temp\w*|thermometer)\b.{0,40}\b(up to|above|over|reading|at)\b.{0,12}\d{2,3}|\b(food|product|stock|inventory)\b.{0,30}\b(spoil|warm|thaw|soft|danger zone|tossed|dump)\w*/i },
];

const SYMPTOMS: ReadonlyArray<{ code: SymptomCode; re: RegExp }> = [
  { code: "BREAKER_TRIP", re: /\b(breaker|fuse|rcd|gfci)\b.{0,25}\b(trip|pop|blow|flip|throw)\w*|\b(trip|pop|blow)\w*\b.{0,25}\bbreaker\b/i },
  { code: "NO_POWER", re: /\b(no power|won'?t (turn on|power|start)|dead|not turning on|nothing happens|sin (corriente|energia|energía))\b/i },
  { code: "OVERHEATING", re: /\b(overheat\w*|running (too )?hot|too hot|excess\w* heat)\b/i },
  { code: "NOT_COOLING", re: /\b(not cool\w*|won'?t cool|warm inside|temp\w* (ris|climb|creep)\w*|no enfr[ií]a|not holding temp)\b/i },
  { code: "NOT_HEATING", re: /\b(not heat\w*|won'?t heat|no heat|not getting (up )?to temp|cold oil)\b/i },
  { code: "LEAKING_WATER", re: /\b(leak\w*|drip\w*|pooling|puddle)\b.{0,25}\b(water|agua)\b|\bwater\b.{0,25}\bleak\w*|\bleak\w*\b(?!.{0,25}(refrigerant|freon|gas))/i },
  { code: "LEAKING_REFRIGERANT", re: /\b(refrigerant|freon|r-?404|r-?134|coolant)\b.{0,25}\b(leak|low|loss)\w*|\bleak\w*\b.{0,20}\b(refrigerant|freon)\b/i },
  { code: "BURNING_SMELL", re: /\b(burn\w*|acrid|electrical)\b.{0,20}\b(smell|odou?r)\b|\b(smell|odou?r)\w*\b.{0,20}\bburn\w*/i },
  { code: "SMOKE", re: /\b(smok\w*|humo)\b/i },
  { code: "GAS_ODOR", re: /\b(gas|propane)\b.{0,25}\b(smell|odou?r|leak)\b/i },
  { code: "UNUSUAL_NOISE", re: /\b(noise|noisy|grind\w*|squeal\w*|rattl\w*|bang\w*|clunk\w*|screech\w*|knock\w*|whin\w*|ruido)\b/i },
  { code: "DOOR_SEAL_FAIL", re: /\b(gasket|seal|door)\b.{0,25}\b(torn|split|broken|not seal\w*|won'?t (close|shut|latch)|loose|cracked)\b|\b(torn|broken|bad)\b.{0,10}\bgasket\b/i },
  { code: "CONTROL_BOARD_ERROR", re: /\b(control (board|panel)|pcb|board)\b.{0,25}\b(error|fault|fail\w*|dead|fried)\b|\b(e-?\d{1,3}|err\s?\d{1,3})\b/i },
  { code: "THERMOSTAT_DRIFT", re: /\b(thermostat|setpoint|set point|calibrat\w*)\b.{0,30}\b(off|drift\w*|wrong|inaccurate|\d+\s*(deg|°))/i },
  { code: "CLOGGED_DRAIN", re: /\b(drain|line|pipe)\b.{0,20}\b(clog\w*|block\w*|back\w*\s*up|plugged)\b|\bback(ed|ing)?\s*up\b/i },
  { code: "ICE_BUILDUP", re: /\b(ice|frost)\b.{0,25}\b(build\w*|up|over|coat\w*|cak\w*)\b|\b(iced|frosted)\s*(up|over)\b/i },
  { code: "VIBRATION", re: /\b(vibrat\w*|shak\w*|wobbl\w*|shudder\w*)\b/i },
  { code: "DISPLAY_ERROR", re: /\b(display|screen|readout|lcd)\b.{0,25}\b(blank|black|frozen|error|garbled|flicker\w*|dead)\b/i },
  { code: "INTERMITTENT_OPERATION", re: /\b(intermittent\w*|on and off|comes? and goes?|sometimes|randomly|every (so often|now and then))\b/i },
  { code: "COMPLETE_FAILURE", re: /\b(completely (dead|down|out)|total(ly)? (fail\w*|dead)|out of (service|order)|unusable|had to shut)\b/i },
];

const ASSET_TYPES: ReadonlyArray<{ code: AssetType; re: RegExp }> = [
  { code: "FRYER", re: /\b(fryer|frier|freidora|fry\s*station)\b/i },
  { code: "GRILL", re: /\b(grill|griddle|broiler|plancha)\b/i },
  { code: "REACH_IN_FREEZER", re: /\b(reach[\s-]?in|freezer|congelador)\b/i },
  { code: "WALK_IN_COOLER", re: /\b(walk[\s-]?in|cooler|c[aá]mara|chiller)\b/i },
  { code: "ICE_MACHINE", re: /\b(ice\s*(machine|maker)|hielo)\b/i },
  { code: "HVAC_RTU", re: /\b(hvac|rtu|roof\s*top|a\/?c\b|air\s*con\w*|aire)\b/i },
  { code: "HOOD_EXHAUST", re: /\b(hood|exhaust|ansul|extractor)\b/i },
  { code: "DISHWASHER", re: /\b(dish\s*(washer|machine)|warewash\w*|lavavajillas)\b/i },
  { code: "COFFEE_BREWER", re: /\b(coffee|brewer|espresso|cafetera)\b/i },
  { code: "WATER_HEATER", re: /\b(water\s*heater|boiler|calentador)\b/i },
  { code: "POS_TERMINAL", re: /\b(pos|register|terminal|till|caja)\b/i },
  { code: "PREP_TABLE", re: /\b(prep\s*(table|unit)|sandwich\s*unit)\b/i },
];

const SEVERITY_HINTS: ReadonlyArray<{ code: Severity; re: RegExp }> = [
  { code: "CRITICAL", re: /\b(evacuat\w*|shut (the )?(store|line|kitchen)|closed? (the )?(store|kitchen)|emergency|fire|can'?t (open|operate|trade)|everything down)\b/i },
  { code: "HIGH", re: /\b(can'?t (serve|sell|cook|use)|down|out of (service|order)|losing (sales|product|stock)|had to (stop|shut)|urgent|asap)\b/i },
  { code: "LOW", re: /\b(minor|cosmetic|when you get a chance|no rush|not urgent|still works|workaround)\b/i },
];

function matchAll<T extends string>(text: string, table: ReadonlyArray<{ code: T; re: RegExp }>): T[] {
  const out: T[] = [];
  for (const { code, re } of table) if (re.test(text)) out.push(code);
  return out;
}

export interface LexiconExtraction {
  assetTypes: AssetType[];
  ordinalHints: number[];
  symptomCodes: SymptomCode[];
  safetyIndicators: SafetyIndicator[];
  severityHint: Severity | null;
  assetTags: string[];
}

/** Explicit tag like "FRY-02" or "fryer 2" / "fryer #2". */
const TAG_RE = /\b([A-Z]{3})[-\s]?(\d{1,2})\b/g;
const ORDINAL_RE = /\b(?:fryer|frier|grill|freezer|cooler|rtu|hood|pos|register|brewer|unit|machine)\s*#?\s*(\d{1,2})\b/gi;

export function lexiconExtract(text: string): LexiconExtraction {
  const assetTags: string[] = [];
  for (const m of text.matchAll(TAG_RE)) assetTags.push(`${m[1]!.toUpperCase()}-${m[2]!.padStart(2, "0")}`);

  const ordinalHints: number[] = [];
  for (const m of text.matchAll(ORDINAL_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 20) ordinalHints.push(n);
  }

  const severities = matchAll(text, SEVERITY_HINTS);
  return {
    assetTypes: matchAll(text, ASSET_TYPES),
    ordinalHints: [...new Set(ordinalHints)],
    symptomCodes: matchAll(text, SYMPTOMS),
    safetyIndicators: matchAll(text, SAFETY),
    // First match wins and the table is ordered CRITICAL -> HIGH -> LOW, so the most
    // severe reading is taken. Under-calling severity is the expensive direction.
    severityHint: severities[0] ?? null,
    assetTags: [...new Set(assetTags)],
  };
}

/**
 * Field-level agreement between the two extractors, in [0,1]. This is c_extract.
 *
 * Safety is weighted heaviest because it is the field where disagreement is most
 * diagnostic: if the lexicon sees a gas smell the model missed, that is exactly the case
 * a human needs to see, and the confidence score should collapse accordingly.
 */
export function agreement(llm: {
  symptomCodes: SymptomCode[]; safetyIndicators: SafetyIndicator[]; assetTypeGuesses: AssetType[];
}, lex: LexiconExtraction): number {
  const j = <T>(a: T[], b: T[]): number => {
    const A = new Set(a), B = new Set(b);
    if (A.size === 0 && B.size === 0) return 1;
    const inter = [...A].filter((x) => B.has(x)).length;
    return inter / (A.size + B.size - inter);
  };
  const symptom = j(llm.symptomCodes, lex.symptomCodes);
  const safety = j(llm.safetyIndicators, lex.safetyIndicators);
  const type = j(llm.assetTypeGuesses, lex.assetTypes);
  return Number((0.3 * symptom + 0.5 * safety + 0.2 * type).toFixed(4));
}
