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


echo "E2E smoke complete for $BASE_URL"
