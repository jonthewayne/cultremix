#!/bin/bash
# Post-create setup for Claude Code in the devcontainer.
# Installs skills, configures hooks, and sets permissions.

set -euo pipefail

# --- Install skills ---
echo "Installing Claude Code skills..."
npx -y skills add https://github.com/vercel-labs/agent-browser --skill agent-browser --agent claude-code -y -g

# --- Fix volume ownership (Docker volumes are created as root, skills may also create root-owned dirs) ---
sudo chown -R node:node /home/node/.claude

# --- Set up git guardrails hook ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Setting up git guardrails hook..."
mkdir -p /home/node/.claude/hooks
# Remove any root-owned file from previous lock-hook.sh runs
sudo rm -f /home/node/.claude/hooks/block-dangerous-git.sh
cp "$SCRIPT_DIR/block-dangerous-git.sh" /home/node/.claude/hooks/
chmod +x ~/.claude/hooks/block-dangerous-git.sh

# --- Configure Claude settings ---
echo "Configuring Claude Code settings..."
tmp=$(mktemp)
(cat ~/.claude/settings.json 2>/dev/null || echo '{}') | jq '. * {
  "permissions": {"defaultMode": "bypassPermissions"},
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/block-dangerous-git.sh"
          }
        ]
      }
    ]
  }
}' > "$tmp" && mv "$tmp" ~/.claude/settings.json

echo "Claude Code setup complete."
