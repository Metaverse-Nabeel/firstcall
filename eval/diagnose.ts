/** Throwaway diagnostic: where do safety and symptom errors come from — LLM or lexicon? */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lexiconExtract } from "../src/agent/lexicon";
import type { EvalCase } from "../src/agent/contracts";

const cases = readFileSync(resolve(process.cwd(), "eval/cases/cases.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l) as EvalCase);

let lexFP = 0, lexTP = 0, lexFN = 0;
const fpByCode: Record<string, number> = {};
console.log("SAFETY false positives from the LEXICON alone:\n");
for (const c of cases) {
  const lex = lexiconExtract(c.report.text);
  const gold = new Set(c.spec.safetyTruth);
  const got = new Set(lex.safetyIndicators);
  const fps = [...got].filter((g) => !gold.has(g));
  const fns = [...gold].filter((g) => !got.has(g));
  for (const f of fps) fpByCode[f] = (fpByCode[f] ?? 0) + 1;
  if (gold.size && got.size) lexTP++;
  if (!gold.size && got.size) { lexFP++; console.log(`  ${c.spec.caseId}  +${fps.join(",")}\n     "${c.report.text.slice(0,120)}"`); }
  if (gold.size && !got.size) lexFN++;
}
console.log(`\nlexicon doc-level: tp=${lexTP} fp=${lexFP} fn=${lexFN}`);
console.log(`false-positive codes:`, fpByCode);

console.log(`\nSYMPTOM contribution:`);
let lexOnlyTp=0, lexOnlyFp=0, lexOnlyFn=0;
for (const c of cases) {
  const lex = lexiconExtract(c.report.text);
  const gold = new Set<string>(c.spec.faultCodes);
  const got = new Set<string>(lex.symptomCodes);
  for (const g of got) (gold.has(g) ? lexOnlyTp++ : lexOnlyFp++);
  for (const g of gold) if (!got.has(g)) lexOnlyFn++;
}
const p = lexOnlyTp/(lexOnlyTp+lexOnlyFp), r = lexOnlyTp/(lexOnlyTp+lexOnlyFn);
console.log(`  lexicon-only symptoms: P=${p.toFixed(3)} R=${r.toFixed(3)} F1=${(2*p*r/(p+r)).toFixed(3)}  (tp=${lexOnlyTp} fp=${lexOnlyFp} fn=${lexOnlyFn})`);
