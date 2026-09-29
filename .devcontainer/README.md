# AI Code Agent Sandbox in VS Code

Run Claude Code and OpenAI Codex CLI with full permissions in a local Docker container, fully integrated with VS Code. No more permission prompts, your local machine stays isolated, and you get a seamless dev experience.

Adapted from [Anthropic's official devcontainer](https://github.com/anthropics/claude-code) with a less restrictive firewall to enable public internet access and [Vercel's agent-browser](https://github.com/vercel-labs/agent-browser) baked in for Claude Code browser automation. Also includes [OpenAI Codex CLI](https://github.com/openai/codex) as a second AI agent.

## Why?

Claude Code with full permissions is powerful but risky on your main machine. Running in default mode means constantly approving permission prompts.

This devcontainer gives Claude full autonomy while keeping it sandboxed. Everything runs inside the container—terminals, extensions, dev servers—but VS Code looks and feels normal. Agentic Ralph loops and experimental workflows become safe to run.

## Setup

**Prerequisites:** Docker Desktop + VS Code with "Dev Containers" extension

1. Clone this repo (or copy `.devcontainer/` to your project)
2. Open in VS Code
3. `Cmd+Shift+P` → "Dev Containers: Reopen in Container"
4. Wait ~5 min for first build (watch the log—it may prompt for input)
5. Open terminal, run `claude`

## What's Included

- **Claude Code** — CLI + VS Code extension, runs in dangerous mode with git guardrails
- **OpenAI Codex CLI** — Runs with `approval_policy = "on-failure"` and `sandbox_mode = "danger-full-access"` (full autonomy within the container, prompts on failure)
- **agent-browser** — Headless Chrome for browser automation
- **git-guardrails** — Claude: custom PreToolUse hook blocks destructive git commands. Codex: `AGENTS.md` instructions (soft guardrail). Both: push restricted to `feature/*` and `fix/*` branches
- **Firewall** — Blocks private networks, allows public internet

## Usage

**Dev servers:** Ports 3000, 5173, 8080 auto-forward to your browser.

**Browser automation:** Just ask Claude to "open localhost:3000 and take a screenshot"

**Your code** is mounted from your local machine—changes sync both ways.

**Downloads folder:** Your `~/Downloads` is mounted read-only at `/drops/` inside the container. Drag files from Finder into the VS Code terminal to reference them.

**Auth & settings** persist across rebuilds (stored in Docker volume).

## Commands

| Action            | How                                 |
| ----------------- | ----------------------------------- |
| Rebuild           | `Cmd+Shift+P` → "Rebuild Container" |
| Update everything | "Rebuild Container Without Cache"   |
| Return to local   | "Reopen Folder Locally"             |

## Shared Memory

The container runs with `--shm-size=512m` (up from Docker's 64MB default). Chromium-based browsers (used by `agent-browser` for E2E tests) crash with the default 64MB `/dev/shm`. If you see "Page crashed" errors during browser automation, this is likely the cause.

## Firewall

Default mode allows public internet but blocks private networks (10.x, 172.16.x, 192.168.x).

For strict mode (allowlist only):

```bash
sudo /usr/local/bin/init-firewall.sh --strict
```

## Adding Skills

```bash
npx -y skills add <repo-url> --skill <name> --agent claude-code -y -g
```

Browse skills at [skills.sh](https://skills.sh)
