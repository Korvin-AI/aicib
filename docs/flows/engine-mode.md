# Engine Mode (Authentication)

## Overview

AICIB supports two ways to authenticate with Claude — your Claude Code subscription (free, already logged in) or your own Anthropic API key (pay-per-use). You choose during setup and can switch anytime.

## Choosing During Setup

When you run `aicib init`, you'll see:

```
? How will your AI company authenticate?
❯ Claude Code subscription (you're already logged in)
  Anthropic API key (enter your key)
```

**Claude Code subscription** — the default. Uses your existing Claude Code login. No extra cost beyond your subscription. Best for personal use and development.

**Anthropic API key** — enter your own `sk-ant-...` key. You pay per token. Best for production use, running in CI/CD, or when you need cloud execution.

If you choose API key, you'll be prompted to enter it:

```
? Anthropic API key: ********
```

The key must start with `sk-ant-`. It's stored in `aicib.config.yaml` (which is gitignored to prevent leaks).

## Switching Modes Later

Run `aicib config` and select "Engine mode":

```
? What would you like to configure?
❯ Engine mode

? Choose engine mode:
  Claude Code subscription (uses your Claude Code login) (current)
❯ Anthropic API key (enter your own key)
  Back
```

### Using an API Key

Two options:

1. **Enter key now** — stored in `aicib.config.yaml`. You'll see:
   ```
   Engine mode set to Claude API key (sk-ant-...xxxx)
   Note: The API key is stored in aicib.config.yaml. Ensure this file is in .gitignore.
   ```

2. **Use environment variable** — set `ANTHROPIC_API_KEY` in your shell. Nothing saved to disk:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-api03-...
   aicib config  # select Engine mode → Anthropic API key → Use environment variable
   ```

### Switching Back to Subscription

Select "Claude Code subscription" in the engine mode menu. The engine section is removed from your config file.

## What Happens If the Key Is Missing

If you're in API key mode but no key is available, AICIB fails fast with a clear error:

```
Error: Engine mode is "claude-api" but no API key found.
  Set it with: aicib config -> Engine mode
  Or export: ANTHROPIC_API_KEY=sk-ant-...
```

This check runs at the start of `aicib start` and `aicib brief` — before any work begins.

## Viewing Current Mode

Run `aicib config` → "View current config":

```
Engine:
  Mode:           API key (sk-ant-...xxxx)
```

Or for subscription mode:

```
Engine:
  Mode:           Claude Code subscription
```

The Web UI settings page also shows the current engine mode.

## Key Priority

If both a config key and an environment variable are set, the config key takes priority:

1. `engine.api_key` in `aicib.config.yaml`
2. `ANTHROPIC_API_KEY` environment variable

## Tips

- **Don't commit your key** — `aicib.config.yaml` is in `.gitignore` by default. If you initialized before this was added, add it manually.
- **Environment variables are safer** — no key on disk. Good for CI/CD and shared machines.
- **Background jobs use the mode that was active when you sent the brief** — changing modes mid-job doesn't affect running work.
- **Slack briefs use the same mode** — if you have Slack integration, briefs from Slack respect your engine config.

## Related

- `aicib config` — Change engine mode and other settings
- `aicib init` — First-time setup where you choose the mode
- `docs/technical/dual-mode-auth.md` — Technical details for developers
