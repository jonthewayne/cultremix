#!/usr/bin/env bash
set -euo pipefail

# The core flow with real image calls, against a local dev server and its dev deployment only. It
# costs about 35¢ of gateway credit and takes 5 to 8 minutes, so it's opt-in:
#   bun run test:e2e:publish
# The dev owner (sam@example.com, signed in with an email code read through the test helper) makes
# a batch from words in quotes, publishes a design to the world, waits for its remixable words,
# remixes it by changing a word box, publishes that as a variation, and checks the family. Both
# designs are taken down at the end, even when a step fails, so the feed doesn't keep them. Needs
# TEST_HELPER_SECRET in .env.local and ENABLE_TEST_OTP_STORAGE=true on the deployment.

BASE_URL="${BASE_URL:-http://localhost:3000}"
case "$BASE_URL" in
  http://localhost* | http://127.0.0.1*) ;;
  *)
    echo "run-publish.sh makes real designs, so it runs only against a local dev server." >&2
    exit 1
    ;;
esac
OWNER_EMAIL="${PUBLISH_E2E_EMAIL:-sam@example.com}"
AGENT_BROWSER_SESSION="publish-e2e-$$"
export AGENT_BROWSER_SESSION
mkdir -p .tmp/screenshots
CR=""
CR2=""
PUBLISHED=""

fail() {
  echo "$1 (on $(agent-browser get url))" >&2
  agent-browser eval "document.body.innerText.slice(0, 400)" >&2 || true
  agent-browser screenshot body .tmp/screenshots/publish-failure.png >/dev/null 2>&1 || true
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
# Waits up to 40 s for text (without apostrophes). Case doesn't matter.
wait_text() {
  for _ in $(seq 1 80); do
    if agent-browser eval "document.body.innerText.toLowerCase().includes('$1'.toLowerCase())" | grep -q true; then return 0; fi
    sleep 0.5
  done
  fail "Missing text after 40 s: $1"
}
go() {
  agent-browser open "$1" >/dev/null
  agent-browser wait --load networkidle >/dev/null 2>&1 || true
  wait_ready "a[href]"
}
# Clicks the first enabled button whose text matches the pattern (a JavaScript regex source).
click_button() {
  agent-browser eval "(() => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp('$1').test(x.innerText.trim()) && !x.disabled); b?.click(); return b ? b.innerText.trim() : ''; })()" | tr -d '"'
}
# Waits up to 4 minutes for the session's designs: none still designing, and a Publish button.
wait_designs() {
  local state=""
  for _ in $(seq 1 120); do
    state=$(agent-browser eval "(() => { const designing = document.querySelectorAll('[aria-label=Designing]').length; const publish = [...document.querySelectorAll('button')].filter((x) => x.innerText.trim() === 'Publish').length; return designing + '/' + publish; })()" | tr -d '"')
    if [[ "$state" == 0/* && "$state" != "0/0" ]]; then return 0; fi
    sleep 2
  done
  fail "The batch's designs didn't arrive in 4 minutes (designing/publishable: $state)"
}
# Publishes the session's first design, after waiting for the text in $1 if given; sets PUBLISHED.
publish_first() {
  [[ -n "$(click_button '^Publish$')" ]] || fail "No Publish button"
  wait_text "Publish as CR"
  if [[ -n "${1:-}" ]]; then wait_text "$1"; fi
  local label
  label=$(click_button '^Publish as CR')
  [[ -n "$label" ]] || fail "No Publish as CR button"
  PUBLISHED="${label#Publish as CR }"
  wait_text "View shop page"
}
take_down() {
  local cr="$1"
  [[ -n "$cr" ]] || return 0
  agent-browser open "$BASE_URL/cr/$cr" >/dev/null 2>&1 || return 0
  for _ in $(seq 1 60); do
    if agent-browser eval "Boolean([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Take this design down') && Object.keys(document.querySelector('a[href]') ?? {}).some((k) => k.startsWith('__reactProps')))" 2>/dev/null | grep -q true; then break; fi
    sleep 1
  done
  agent-browser find role button click --name "Take this design down" >/dev/null 2>&1 || return 0
  agent-browser fill "#takedown-reason" "End-to-end test (tests/e2e/run-publish.sh)" >/dev/null 2>&1 || return 0
  agent-browser find role button click --name "Take it down" >/dev/null 2>&1 || return 0
  for _ in $(seq 1 30); do
    if [[ "$(agent-browser get url 2>/dev/null)" == "$BASE_URL/" ]]; then
      echo "Took down CR $cr"
      return 0
    fi
    sleep 1
  done
  echo "Couldn't confirm CR $cr was taken down; take it down from its page." >&2
}
cleanup() {
  take_down "$CR2" || true
  take_down "$CR" || true
  agent-browser close >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Sign in as the dev owner with an email code.
go "$BASE_URL/login"
wait_ready "form input"
agent-browser find label "Email" fill "$OWNER_EMAIL" >/dev/null
agent-browser find role button click --name "Get a code" >/dev/null
wait_text "Check your email"
code="$(bun scripts/e2e-helper.ts otp "$OWNER_EMAIL")"
wait_ready "form input"
agent-browser find label "6-digit code" fill "$code" >/dev/null
for _ in $(seq 1 60); do
  case "$(agent-browser get url)" in */verify-email*) sleep 1 ;; *) break ;; esac
done

# A batch from words in quotes.
go "$BASE_URL/studio"
wait_text "What do you want to make?"
wait_ready "textarea"
agent-browser fill "textarea" 'A round sticker of a cactus in sunglasses that says "STAY SHARP"' >/dev/null
[[ -n "$(click_button '^Generate')" ]] || fail "No Generate button"
wait_designs
agent-browser screenshot body .tmp/screenshots/publish-batch.png >/dev/null

# Published to the world, it gets a CR number, and its remixable words are read from it.
publish_first
CR="$PUBLISHED"
family="${CR%%-*}"
words=""
for _ in $(seq 1 12); do
  go "$BASE_URL/cr/$CR"
  if agent-browser eval "(() => { const t = document.body.innerText.toUpperCase(); const i = t.indexOf('REMIXABLE PARTS'); return i >= 0 && t.slice(i, i + 600).includes('SHARP'); })()" | grep -q true; then
    words=yes
    break
  fi
  sleep 8
done
[[ -n "$words" ]] || fail "CR $CR's remixable words never listed SHARP"
agent-browser screenshot body .tmp/screenshots/publish-work.png >/dev/null

# Remix this: change the word box with SHARP to WEIRD, make a batch, and publish it as a variation.
agent-browser find role link click --name "Remix this" >/dev/null
started=""
for _ in $(seq 1 60); do
  case "$(agent-browser get url)" in *"s="*) started=yes; break ;; esac
  sleep 1
done
[[ -n "$started" ]] || fail "Remix this didn't start a remix session in 60 s"
wait_text "Remixing"
changed=""
for _ in $(seq 1 60); do
  changed=$(agent-browser eval "(() => { const el = [...document.querySelectorAll('input[id], textarea[id]')].find((x) => /-t\\d+$/.test(x.id) && /SHARP/i.test(x.value)); if (!el || !Object.keys(el).some((k) => k.startsWith('__reactProps'))) return ''; const next = el.value.replace(/SHARP/i, (m) => (m === m.toUpperCase() ? 'WEIRD' : 'Weird')); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next); el.dispatchEvent(new Event('input', { bubbles: true })); return next; })()" | tr -d '"')
  [[ -n "$changed" ]] && break
  sleep 1
done
[[ -n "$changed" ]] || fail "No word box with SHARP in the remix"
sleep 1
[[ -n "$(click_button '^Generate')" ]] || fail "Generate didn't turn on after changing the words"
wait_designs
wait_text "Changed the words"
publish_first "A variation of CR $CR"
CR2="$PUBLISHED"
go "$BASE_URL/cr/$CR2"
wait_text "A variation of CR $CR"
go "$BASE_URL/family/$family"
wait_text "2 designs"
agent-browser screenshot body .tmp/screenshots/publish-family.png >/dev/null

echo "Publish E2E complete for $BASE_URL: CR $CR and its variation CR $CR2 (both taken down next)"
