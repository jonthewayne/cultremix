#!/usr/bin/env bash
set -euo pipefail

# Accessibility check: axe-core (WCAG 2.1 A and AA rules) on the public pages, at phone width, in a
# fresh browser. It fails on any serious or critical violation and prints each one with an example
# element. Read-only, so it runs against production too:
#   BASE_URL=https://cultremix.com bun run test:a11y
# Pages that need data (a work, its family, its creator) come from the first work in the feed.

BASE_URL="${BASE_URL:-http://localhost:3000}"
AGENT_BROWSER_SESSION="a11y-$$"
export AGENT_BROWSER_SESSION
AXE="node_modules/axe-core/axe.min.js"
[[ -f "$AXE" ]] || { echo "axe-core isn't installed; run bun install" >&2; exit 1; }
axe_source="$(cat "$AXE")"

cleanup() { agent-browser close >/dev/null 2>&1 || true; }
trap cleanup EXIT

agent-browser set viewport 390 844 >/dev/null

# Opens a page, waits until React has hydrated it, and runs axe. Prints the page's violations.
check() {
  agent-browser open "$1" >/dev/null
  agent-browser wait --load networkidle >/dev/null 2>&1 || true
  for _ in $(seq 1 120); do
    if agent-browser eval "(() => { const el = document.querySelector('a[href]'); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')); })()" | grep -q true; then break; fi
    sleep 0.5
  done
  agent-browser eval "$axe_source; 'loaded'" >/dev/null
  agent-browser eval "axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.impact + ' ' + v.id + ' (' + v.nodes.length + ') e.g. ' + v.nodes[0].target.join(' ').slice(0, 100)).join(' | '))" | tr -d '"'
}

pages=("$BASE_URL/" "$BASE_URL/how-it-works" "$BASE_URL/onchain" "$BASE_URL/login" "$BASE_URL/policies/terms")
agent-browser open "$BASE_URL/" >/dev/null
agent-browser wait --load networkidle >/dev/null 2>&1 || true
work_path=$(agent-browser eval "document.querySelector('main a[href^=\"/cr/\"]')?.getAttribute('href') ?? ''" | tr -d '"')
if [[ -n "$work_path" ]]; then
  pages+=("$BASE_URL$work_path")
  family="${work_path#/cr/}"
  pages+=("$BASE_URL/family/${family%%-*}")
fi
creator=$(agent-browser eval "document.querySelector('main a[href^=\"/u/\"]')?.getAttribute('href') ?? ''" | tr -d '"')
[[ -n "$creator" ]] && pages+=("$BASE_URL$creator")

failed=0
for page in "${pages[@]}"; do
  found="$(check "$page")"
  if [[ -n "$found" ]]; then
    echo "FAIL $page: $found"
    failed=1
  else
    echo "ok   $page"
  fi
done
[[ "$failed" == 0 ]] || { echo "Accessibility check failed" >&2; exit 1; }
echo "Accessibility check complete for $BASE_URL"
