# Template System

## What It Does

Two-layer composable template system: **Structure** (org chart shape) × **Industry** (domain expertise). Users pick one of each during `aicib init` — e.g., "Full C-Suite + SaaS Startup" — and get a complete agent team with industry-specific knowledge baked in.

## Architecture

### Two Template Sources

1. **Package templates** — bundled with aicib under `src/templates/`
   - `structures/` — YAML files defining org chart shapes (roles, reporting lines, departments)
   - `industries/` — directories with `manifest.yaml` + `agents/` (industry-specific soul.md files)
   - `presets/` — shared persona presets

2. **User templates** — installed via `aicib template import` into `~/.aicib/templates/`
   - Each template is a directory containing `template.yaml` manifest
   - May include `structure.yaml` and/or `industry/` subdirectory
   - Merged with package templates at query time (user templates don't overwrite package files)

### Key Files

- `src/core/template-registry.ts` — Lists/loads structures and industries. Merges package + user dirs.
- `src/core/template-composer.ts` — Composes structure + industry into config YAML + agent files.
- `src/core/template-packager.ts` — Export/import community template packages.
- `src/core/agents.ts` — `listTemplates()` for legacy single-directory templates. Also exports dir getters.
- `src/cli/init.ts` — The `aicib init` flow: template selection → composition → file writing.

### Template Resolution Flow

```
aicib init --template saas-startup
  → resolveTemplate("saas-startup")
  → TEMPLATE_ALIASES["saas-startup"] = { structure: "full-c-suite", industry: "saas-startup" }
  → composeTemplate("full-c-suite", "saas-startup", companyName, preset)
  → writes aicib.config.yaml + .claude/agents/*.md
```

### Legacy vs New Templates

Legacy templates (e.g., `src/templates/saas-startup/`) are single directories with `config.yaml` + `agents/`. The new system uses the two-layer structure×industry approach. Both paths are supported:

- `listTemplates()` returns only directories with legacy shape (`config.yaml` + `agents/` subdir)
- New dirs like `industries/`, `structures/`, `presets/` are excluded from legacy detection

### Community Template Import

```
aicib template import ./my-template/
  → validateTemplatePackage() checks structure
  → sanitizeTemplateName() rejects invalid names (path traversal protection)
  → copies to ~/.aicib/templates/<name>/
  → registry functions automatically discover user templates
```

## Security

- **Path traversal protection:** `sanitizeTemplateName()` rejects any name not matching `[a-z0-9-]`. Called before any path construction in `importTemplate()`. Prevents `name: "../../etc"` attacks.
- **User templates are read-only to package dirs:** `importTemplate()` only writes to `~/.aicib/templates/`. It does NOT modify the package's `src/templates/` directories.

## Dynamic Org Chart

`printOrgChart()` renders the org chart dynamically from the structure definition:
- Finds CEO by `reports_to: "human-founder"`
- Finds C-suite by `reports_to: <ceoRole>` (uses detected role key, not hardcoded)
- Colors by department (engineering=cyan, finance=green, marketing=magenta)

## Related

- `docs/technical/persona-system.md` — Persona presets applied during template composition
