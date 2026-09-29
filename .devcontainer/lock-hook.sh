#!/bin/bash
# Locks the git guardrails hook so non-root users cannot modify it.
set -euo pipefail
HOOK="/home/node/.claude/hooks/block-dangerous-git.sh"
if [ -f "$HOOK" ]; then
  chown root:root "$HOOK"
  chmod 555 "$HOOK"
  echo "Hook locked: $HOOK"
else
  echo "Hook not found: $HOOK (skipping)"
fi
