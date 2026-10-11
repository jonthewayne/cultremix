#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-starter-e2e-$$}"
export AGENT_BROWSER_SESSION
mkdir -p .tmp/screenshots
trap 'agent-browser close >/dev/null 2>&1 || true' EXIT

# CultRemix's sign-in pages have one black-and-white look, so there is no theme toggle to check.
assert_text() {
  local expected="$1"
  agent-browser eval "if (!document.body.innerText.includes('$expected')) throw new Error('Missing text: $expected'); true"
}

agent-browser open "$BASE_URL/login"
agent-browser storage local set theme light
agent-browser open "$BASE_URL/login"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/login-light.png
assert_text "Sign in"

agent-browser storage local set theme dark
agent-browser open "$BASE_URL/verify-email?email=test@example.com"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/verify-email-dark.png
assert_text "Check your email"

agent-browser open "$BASE_URL/verify-phone?phone=%2B14155552671"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/verify-phone-dark.png
assert_text "Check your phone"

agent-browser open "$BASE_URL/invite/accept"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/invite-accept-dark.png
assert_text "Invite missing"

agent-browser open "$BASE_URL/unauthorized"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/unauthorized-dark.png
assert_text "Unauthorized"

# Public pages, signed out: the feed, a work page, its family tree, its creator's profile, and the
# economics rules. The work is whichever one the feed links first, so this runs on any environment,
# production included.
assert_no_broken_images() {
  agent-browser eval "(() => { const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src); if (broken.length) throw new Error('Broken images: ' + broken.join(', ')); return true })()"
}

# Security headers (src/start.ts) on a deployed site; a local dev server loads them when it starts.
if [[ "$BASE_URL" == https://* ]]; then
  page_headers="$(curl -fsS -D - -o /dev/null "$BASE_URL/")"
  expected=("x-frame-options: DENY" "x-content-type-options: nosniff")
  [[ "$BASE_URL" == *cultremix.com* ]] && expected+=("strict-transport-security: max-age=")
  for header in "${expected[@]}"; do
    grep -qi "^$header" <<<"$page_headers" || { echo "$BASE_URL/ is missing the header: $header"; exit 1; }
  done
fi

agent-browser open "$BASE_URL/"
agent-browser wait 1500
assert_text "get paid."
assert_text "Latest"
assert_text "Trending"
assert_no_broken_images
agent-browser screenshot body .tmp/screenshots/home.png

work_path=$(agent-browser eval "document.querySelector('main a[href^=\"/cr/\"]')?.getAttribute('href') ?? ''" | tr -d '"')
if [[ -z "$work_path" ]]; then
  echo "No published works on $BASE_URL; skipping the work, family, and profile pages."
else
  cr="${work_path#/cr/}"
  family="${cr%%-*}"
  agent-browser open "$BASE_URL$work_path"
  agent-browser wait 1500
  assert_text "$cr"
  assert_text "SHA-256"
  assert_no_broken_images
  agent-browser screenshot body .tmp/screenshots/work.png
  # Its fingerprint (under the Fingerprint heading; the economics rules file has a SHA-256 too),
  # for /onchain's check below.
  fingerprint=$(agent-browser eval "(() => { const heading = Array.from(document.querySelectorAll('p')).find((p) => p.innerText.trim().toLowerCase() === 'fingerprint'); return ((heading?.nextElementSibling?.textContent ?? '').match(/[0-9a-f]{64}/) || [''])[0]; })()" | tr -d '"')
  profile_path=$(agent-browser eval "document.querySelector('main a[href^=\"/u/\"]')?.getAttribute('href') ?? ''" | tr -d '"')

  agent-browser open "$BASE_URL/family/$family"
  agent-browser wait 1500
  assert_text "Family $family"
  assert_text "$cr"
  assert_no_broken_images
  agent-browser screenshot body .tmp/screenshots/family.png

  if [[ -n "$profile_path" ]]; then
    agent-browser open "$BASE_URL$profile_path"
    agent-browser wait 1500
    assert_text "${profile_path#/u/}"
    assert_no_broken_images
    agent-browser screenshot body .tmp/screenshots/profile.png
  fi
fi

if ! curl -fsS "$BASE_URL/economics/v1.json" | grep -q '"creatorPoolBps"'; then
  echo "economics/v1.json is missing or wrong on $BASE_URL"
  exit 1
fi
if ! curl -fsS "$BASE_URL/sitemap.xml" | grep -q "/cr/"; then
  echo "sitemap.xml is missing or lists no works on $BASE_URL"
  exit 1
fi
if ! curl -fsS "$BASE_URL/robots.txt" | grep -q "^Sitemap: "; then
  echo "robots.txt is missing or wrong on $BASE_URL"
  exit 1
fi

agent-browser open "$BASE_URL/onchain"
agent-browser wait 1500
assert_text "On Monad"
agent-browser screenshot body .tmp/screenshots/onchain.png

# Which design is this file? A work's fingerprint pasted in names that work.
if [[ -n "${fingerprint:-}" ]]; then
  for _ in $(seq 1 60); do
    if agent-browser eval "(() => { const el = document.querySelector('input[placeholder^=\"SHA-256\"]'); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')); })()" | grep -q true; then break; fi
    sleep 0.5
  done
  matched=""
  for attempt in $(seq 1 60); do
    # A late render can clear the box (once, right after a production build): fill it again
    # whenever it doesn't hold the fingerprint.
    if (( attempt % 6 == 1 )) && ! agent-browser eval "document.querySelector('input[placeholder^=\"SHA-256\"]')?.value === '$fingerprint'" | grep -q true; then
      agent-browser find placeholder "SHA-256, 64 characters" fill "$fingerprint" >/dev/null
    fi
    if agent-browser eval "document.body.innerText.includes('It matches CR $cr')" | grep -q true; then matched=yes; break; fi
    sleep 0.5
  done
  [[ -n "$matched" ]] || { echo "/onchain didn't name CR $cr for its fingerprint $fingerprint"; exit 1; }
fi

# The store policies, linked from the footer.
for policy in shipping returns privacy terms; do
  agent-browser open "$BASE_URL/policies/$policy"
  agent-browser wait 1000
  assert_text "heyyo@cultremix.com"
done
assert_text "Terms"
agent-browser screenshot body .tmp/screenshots/policies-terms.png

echo "E2E smoke complete for $BASE_URL"

# Signed in, against a local dev server only: it signs up a test member through the test helpers
# (TEST_HELPER_SECRET in .env.local), and production refuses those.
if [[ "$BASE_URL" == http://localhost* || "$BASE_URL" == http://127.0.0.1* ]] && grep -q '^TEST_HELPER_SECRET=.' .env.local 2>/dev/null; then
  BASE_URL="$BASE_URL" bash tests/e2e/run-signed-in.sh
fi
