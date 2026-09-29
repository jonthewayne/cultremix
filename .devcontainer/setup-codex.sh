#!/bin/bash
# Post-create setup for OpenAI Codex CLI in the devcontainer.

set -euo pipefail

echo "Setting up Codex CLI..."

mkdir -p ~/.codex

cat > ~/.codex/config.toml << 'TOML'
# Codex CLI configuration
approval_policy = "on-failure"
sandbox_mode = "danger-full-access"
TOML

echo "Codex CLI setup complete."
