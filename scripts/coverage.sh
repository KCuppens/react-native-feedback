#!/usr/bin/env bash
# Line coverage per workspace plus the combined total.
set -e
cd "$(dirname "$0")/.."
for w in packages/core packages/native packages/react apps/worker; do
  (cd "$w" && ../../node_modules/.bin/vitest run --coverage --coverage.include='src/**' --coverage.reporter=json-summary --coverage.reporter=json >/dev/null 2>&1) || { echo "tests failed in $w"; exit 1; }
done
node -e '
let c = 0, t = 0;
for (const w of ["packages/core", "packages/native", "packages/react", "apps/worker"]) {
  const s = require("./" + w + "/coverage/coverage-summary.json").total.lines;
  c += s.covered; t += s.total;
  console.log(w.padEnd(16), String(s.pct).padStart(6) + "%", s.covered + "/" + s.total);
}
console.log("TOTAL".padEnd(16), (100 * c / t).toFixed(2).padStart(6) + "%", c + "/" + t);'
