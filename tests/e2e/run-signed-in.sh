#!/usr/bin/env bash
set -euo pipefail

# Signed-in browser test against a local dev server and its dev deployment: a new member signs up
# with an email code (read through the test helper, since no email is sent), picks a username,
# opens the studio, a work page and its Remix this, their profile, notifications, and settings;
# then, as an owner, the admin tabs, running axe-core's accessibility rules on each. The member
# and what it made are removed at the end. It
# changes nothing else, and needs TEST_HELPER_SECRET in .env.local and
# ENABLE_TEST_OTP_STORAGE=true on the deployment.
#
# Timeouts are long because a fresh browser on a busy machine can take 30 s or more to hydrate a
# dev-mode page; until then the server-rendered page looks done but doesn't respond.

BASE_URL="${BASE_URL:-http://localhost:3000}"
AGENT_BROWSER_SESSION="signed-in-e2e-$$"
export AGENT_BROWSER_SESSION
stamp="$(date +%s)$RANDOM"
EMAIL="e2e+${stamp}@example.com"
NAME="e2e${stamp: -9}"
mkdir -p .tmp/screenshots

cleanup() {
  bun scripts/e2e-helper.ts cleanup "$EMAIL" >/dev/null 2>&1 || true
  agent-browser close >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "$1 (on $(agent-browser get url))" >&2
  agent-browser eval "document.body.innerText.slice(0, 400)" >&2 || true
  agent-browser screenshot body .tmp/screenshots/signed-in-failure.png >/dev/null 2>&1 || true
  exit 1
}
# Waits up to 60 s until React has hydrated the element (its props are attached).
wait_ready() {
  for _ in $(seq 1 120); do
    if agent-browser eval "(() => { const el = document.querySelector('$1'); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')); })()" | grep -q true; then return 0; fi
    sleep 0.5
  done
  fail "Not interactive after 60 s: $1"
}
# Waits up to 40 s for text (without apostrophes, which would end the quoted string). Case
# doesn't matter: the page's text follows CSS, so uppercase labels read in capitals.
wait_text() {
  for _ in $(seq 1 80); do
    if agent-browser eval "document.body.innerText.toLowerCase().includes('$1'.toLowerCase())" | grep -q true; then return 0; fi
    sleep 0.5
  done
  fail "Missing text after 40 s: $1"
}
# axe-core's WCAG 2.1 A and AA rules on the page as it is, like test:a11y does for public pages.
# Fails on a serious or critical violation, naming the rule and an example element.
AXE="node_modules/axe-core/axe.min.js"
[[ -f "$AXE" ]] || { echo "axe-core isn't installed; run bun install" >&2; exit 1; }
axe_source="$(cat "$AXE")"
a11y() {
  agent-browser eval "$axe_source; 'loaded'" >/dev/null
  found=$(agent-browser eval "axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.impact + ' ' + v.id + ' (' + v.nodes.length + ') e.g. ' + v.nodes[0].target.join(' ').slice(0, 100)).join(' | '))" | tr -d '"')
  [[ -z "$found" ]] || fail "Accessibility: $found"
}
# Opens a page and waits until it responds.
go() {
  agent-browser open "$1" >/dev/null
  agent-browser wait --load networkidle >/dev/null 2>&1 || true
  wait_ready "a[href]"
}

# Sign up with an email code.
go "$BASE_URL/login"
wait_ready "form input"
agent-browser find label "Email" fill "$EMAIL" >/dev/null
agent-browser find role button click --name "Get a code" >/dev/null
wait_text "Check your email"
code="$(bun scripts/e2e-helper.ts otp "$EMAIL")"
wait_ready "form input"
agent-browser find label "6-digit code" fill "$code" >/dev/null

# A new member picks a username, then lands in the studio.
wait_text "Pick your name."
wait_ready "input[placeholder=yourname]"
agent-browser find placeholder "yourname" fill "$NAME" >/dev/null
agent-browser find role button click --name "Continue" >/dev/null
wait_text "What do you want to make?"
wait_text "Generate"
a11y
agent-browser screenshot body .tmp/screenshots/signed-in-studio.png >/dev/null

# A work page, signed in: a heart button and Remix this, which starts a remix session.
go "$BASE_URL/"
wait_text "Latest"
work_path=$(agent-browser eval "document.querySelector('main a[href^=\"/cr/\"]')?.getAttribute('href') ?? ''" | tr -d '"')
if [[ -n "$work_path" ]]; then
  go "$BASE_URL$work_path"
  wait_text "Remix this"
  agent-browser eval "if (!document.querySelector('[aria-label^=\"Heart this design\"], [aria-label^=\"Remove heart\"]')) throw new Error('No heart button'); true" >/dev/null
  agent-browser find role link click --name "Remix this" >/dev/null
  started=""
  for _ in $(seq 1 60); do
    case "$(agent-browser get url)" in *"s="*) started=yes; break ;; esac
    sleep 1
  done
  [[ -n "$started" ]] || fail "Remix this didn't start a remix session in 60 s"
  wait_text "Remixing"
  a11y
  agent-browser screenshot body .tmp/screenshots/signed-in-remix.png >/dev/null
fi

# Their own profile has the Kept shelf; notifications and settings open.
go "$BASE_URL/u/$NAME"
wait_text "@$NAME"
wait_text "Kept"
go "$BASE_URL/u/$NAME?shelf=kept"
wait_text "Nothing kept yet."
a11y
go "$BASE_URL/notifications"
wait_text "Notifications"
a11y
go "$BASE_URL/me/earnings"
wait_text "Earnings"
a11y
go "$BASE_URL/settings"
wait_text "Settings"
a11y

# As an owner: the admin tabs load.
bun scripts/e2e-helper.ts role "$EMAIL" super_admin_owner
go "$BASE_URL/admin"
wait_text "Switches"
wait_text "Gateway credit"
wait_text "Ready to sell"
a11y
go "$BASE_URL/admin/products"
wait_text "Add a product"
wait_text "Edit how it sells"
a11y
go "$BASE_URL/admin/sale"
wait_text "Approve a published work"
wait_text "Connect Printful"
a11y
go "$BASE_URL/admin/orders"
wait_text "Latest 50"
a11y
go "$BASE_URL/admin/payouts"
wait_text "Recent payouts"
a11y
go "$BASE_URL/admin/members"
wait_text "Members"
a11y
go "$BASE_URL/admin/metrics"
wait_text "Metrics"
a11y
go "$BASE_URL/admin/waitlist"
wait_text "Email them"
a11y
go "$BASE_URL/admin/chain"
wait_text "Relayer"
a11y
agent-browser screenshot body .tmp/screenshots/signed-in-admin-metrics.png >/dev/null

# Every page above was a full load while signed in. React reports a server render that the browser
# drew differently ("Hydration failed"), as when the live client's first anonymous results replaced
# what the server sent (fixed by the cr-session meta, src/lib/sessionMeta.ts).
hydration=$(agent-browser errors --json 2>/dev/null | bun -e 'const text = await new Response(Bun.stdin.stream()).text(); try { const errors = JSON.parse(text).data?.errors ?? []; console.log(errors.filter((e) => /Hydration failed/.test(e.text ?? "")).length); } catch { console.log("unreadable"); }')
[[ "$hydration" == "0" ]] || fail "Signed-in pages failed to hydrate: $hydration hydration errors"

echo "Signed-in E2E complete for $BASE_URL"

