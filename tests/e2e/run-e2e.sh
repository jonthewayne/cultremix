#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-starter-e2e-$$}"
export AGENT_BROWSER_SESSION
mkdir -p .tmp/screenshots
trap 'agent-browser close >/dev/null 2>&1 || true' EXIT

assert_text_and_theme_toggle() {
  local expected="$1"
  agent-browser eval "if (!document.body.innerText.includes('$expected')) throw new Error('Missing text: $expected'); if (!document.querySelector('[aria-label=\"Toggle theme\"]')) throw new Error('Missing theme toggle'); true"
}

agent-browser open "$BASE_URL/login"
agent-browser storage local set theme light
agent-browser open "$BASE_URL/login"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/login-light.png
assert_text_and_theme_toggle "Sign in"

agent-browser storage local set theme dark
agent-browser open "$BASE_URL/verify-email?email=test@example.com"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/verify-email-dark.png
assert_text_and_theme_toggle "Check your email"

agent-browser open "$BASE_URL/verify-phone?phone=%2B14155552671"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/verify-phone-dark.png
assert_text_and_theme_toggle "Check your phone"

agent-browser open "$BASE_URL/invite/accept"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/invite-accept-dark.png
assert_text_and_theme_toggle "Invite missing"

agent-browser open "$BASE_URL/unauthorized"
agent-browser wait 500
agent-browser screenshot body .tmp/screenshots/unauthorized-dark.png
assert_text_and_theme_toggle "Unauthorized"

echo "E2E smoke complete for $BASE_URL"
