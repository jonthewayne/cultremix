#!/bin/bash
# Claude Code PreToolUse hook: blocks dangerous git commands.
# Allows push on feature/* and fix/* branches only.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

DANGEROUS_PATTERNS=(
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

# Handle git push separately: allow on feature/fix branches, block elsewhere
if echo "$COMMAND" | grep -qE "push --force|push.*--force-with-lease"; then
  echo "BLOCKED: '$COMMAND' — force push is never allowed. The user has prevented you from doing this." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE "git push"; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  if echo "$CURRENT_BRANCH" | grep -qE "^(feature|fix)[-/]"; then
    exit 0
  else
    echo "BLOCKED: '$COMMAND' — push only allowed on feature/* or fix/* branches (current: $CURRENT_BRANCH). The user has prevented you from doing this." >&2
    exit 2
  fi
fi

exit 0
