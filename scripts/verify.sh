#!/usr/bin/env bash
# Full verification gate. Run before submission and after any change to the pipeline.
#
# The first check is the one that matters: a grader with no API key must be able to clone
# this repo and reproduce every number in it. If that fails, nothing else here counts.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "1. Grader simulation — clean clone, no API key, offline"
tmp=$(mktemp -d)
if git clone -q "$(pwd)" "$tmp/fc" 2>/dev/null; then
  ( cd "$tmp/fc" && npm ci --silent >/dev/null 2>&1 \
    && env -u GOOGLE_API_KEY EVAL_MODE=replay npm run eval --silent >"$tmp/out.txt" 2>&1 )
  if [ $? -eq 0 ] && grep -q "All red gates passed" "$tmp/out.txt"; then
    ok "clean clone runs offline from fixtures and exits 0"
  else
    bad "clean clone failed — see $tmp/out.txt"; tail -20 "$tmp/out.txt"
  fi
else
  bad "git clone failed"
fi

echo "2. Unit tests"
npm test --silent >/dev/null 2>&1 && ok "33 rules-engine tests" || bad "unit tests"

echo "3. Typecheck and build"
npx tsc --noEmit >/dev/null 2>&1 && ok "typecheck" || bad "typecheck"
npm run build --silent >/dev/null 2>&1 && ok "next build" || bad "next build"

echo "4. Determinism — two replay runs must be byte-identical"
env -u GOOGLE_API_KEY npm run eval --silent >/dev/null 2>&1
cp eval/results/scorecard.json "$tmp/a.json" 2>/dev/null
env -u GOOGLE_API_KEY npm run eval --silent >/dev/null 2>&1
cmp -s "$tmp/a.json" eval/results/scorecard.json && ok "identical scorecards" || bad "scorecard drifted between runs"

echo "5. Frozen clock — a year of system drift must not move the scorecard"
if command -v faketime >/dev/null 2>&1; then
  faketime '+1 year' env -u GOOGLE_API_KEY npm run eval --silent >/dev/null 2>&1
  cmp -s "$tmp/a.json" eval/results/scorecard.json && ok "clock is frozen" || bad "scorecard moved under a shifted system date"
else
  echo "  SKIP  faketime not installed (brew install libfaketime) — clock injection is unit-tested instead"
fi

echo "6. Secret scan across the whole history"
if git log -p | grep -qnE 'AIza[0-9A-Za-z_-]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}'; then
  bad "a secret pattern appears in git history"
else
  ok "no secret patterns in any commit"
fi
[ -f .git/hooks/pre-commit ] && ok "pre-commit hook installed" || bad "pre-commit hook NOT installed (npm run setup:hooks)"

echo "7. Deliverable caps"
cs=$(wc -w < docs/case-study.md 2>/dev/null || echo 99999)
at=$(wc -w < docs/ai-tool-use.md 2>/dev/null || echo 99999)
[ "$cs" -le 3900 ] && ok "case study $cs words (<= 3900 ~ 8pp)" || bad "case study $cs words — OVER 8 pages"
[ "$at" -le 600 ]  && ok "ai-tool-use $at words (<= 600 ~ 1pp)" || bad "ai-tool-use $at words — OVER 1 page"

echo "8. Repo contains only deliverables"
stray=$(git ls-files | grep -vE '^(README|CLAUDE|AGENT)\.md$|^LICENSE$|^\.(gitignore|env\.example)$|^(package|package-lock|tsconfig|vitest\.config|next\.config|next-env)|^(src|app|eval|docs|fixtures|scripts|\.claude)/' || true)
[ -z "$stray" ] && ok "every tracked file is prototype, docs, eval or config" || { bad "unexpected tracked files:"; echo "$stray" | sed 's/^/        /'; }

rm -rf "$tmp"
echo
[ "$fail" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "VERIFICATION FAILED"
exit $fail
