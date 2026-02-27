# Choosing AI Models for Your Team

## Overview

You can assign different AI models to different agents — like hiring employees at different salary levels. The CEO gets the expensive, smartest model. Junior workers get the fast, cheap one. This can cut your AI costs by 60-70%.

## The Three Models

| Model | Think of it as... | Best for | Cost |
|-------|------------------|----------|------|
| **opus** | Senior executive | CEO, strategic decisions, complex planning | Most expensive |
| **sonnet** | Mid-level manager | Department heads, analysis, writing | Mid-range |
| **haiku** | Efficient assistant | Simple tasks, summaries, quick lookups | Cheapest |

## How to Set It Up

Open your `aicib.config.yaml` file. Each agent has a `model` setting:

```yaml
agents:
  ceo:
    enabled: true
    model: opus          # smartest brain for the boss
  cto:
    enabled: true
    model: opus          # technical strategy needs strong reasoning
    workers:
      - backend-engineer:
          model: sonnet  # solid worker, doesn't need the top tier
      - frontend-engineer:
          model: sonnet
  cfo:
    enabled: true
    model: sonnet        # financial analysis doesn't need opus
    workers:
      - financial-analyst:
          model: sonnet
  cmo:
    enabled: true
    model: sonnet
    workers:
      - content-writer:
          model: sonnet
```

To change an agent's model, just edit the `model:` line and save the file. The change takes effect next time you run `aicib start` or `aicib brief`.

## Accepted Model Names

You can use either the short name or the full name:

| Short name | Full name | Same thing? |
|-----------|-----------|-------------|
| `opus` | `claude-opus-4-6` | Yes |
| `sonnet` | `claude-sonnet-4-6` | Yes |
| `haiku` | `claude-haiku-4-5-20251001` | Yes |

Short names are easier. Use those.

Any name starting with `claude-` is also accepted — this means when Anthropic releases new models in the future, you can use them immediately by typing the full model ID, even before AICIB updates its catalog.

## Recommended Setups

### Budget-Friendly (lowest cost)
```yaml
ceo:    model: sonnet
cto:    model: sonnet
cfo:    model: haiku
cmo:    model: haiku
```
Good for: testing, simple briefs, tight budgets.

### Balanced (default)
```yaml
ceo:    model: opus
cto:    model: opus
cfo:    model: sonnet
cmo:    model: sonnet
```
Good for: real work sessions, strategic planning.

### All-In (best quality)
```yaml
ceo:    model: opus
cto:    model: opus
cfo:    model: opus
cmo:    model: opus
```
Good for: important deliverables, complex multi-department projects. Most expensive.

## Seeing What Each Model Costs

Run `aicib cost` to see a breakdown by agent and model. The cost report shows entries like `ceo-opus` or `cfo-sonnet` so you can see exactly which models are driving your spend.

See [Cost Tracking & Budgets](cost-and-budgets.md) for full details on cost monitoring and budget alerts.

## What Can Go Wrong

- **Typo in model name** → AICIB catches this at startup: `"agents.cto.model 'opsu' is not a recognized model name."` Fix the typo and try again.
- **Unknown model warning in console** → You used a full model ID that AICIB doesn't have in its catalog (e.g., a brand-new model). It will still work — the system treats it as sonnet-tier for pricing estimates. Update AICIB for accurate pricing.
- **CEO on haiku performs poorly** → Haiku is fast but less capable at complex reasoning. If the CEO isn't delegating well or producing shallow plans, upgrade to sonnet or opus.
