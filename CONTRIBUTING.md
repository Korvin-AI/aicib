# Contributing to AICIB

Thanks for your interest in contributing to AI Company-in-a-Box!

## Getting Started

### Prerequisites
- Node.js 18+
- npm 9+
- A Claude Code subscription (for running the AI agents)

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Link locally: `npm link`
5. Test: `aicib init --name "TestCo"` in a scratch directory

### Project Structure
- `src/cli/` — CLI command handlers
- `src/core/` — Core engine (agent runner, config, cost tracking)
- `src/templates/` — Company templates with agent soul.md files
- `docs/` — Documentation and examples
- `tests/` — Test suites

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Ensure `npm run build` passes
4. Run smoke test: `npx tsx tests/smoke-basic.ts` (requires Claude Code subscription)
5. Submit a PR with a clear description

### Code Style
- TypeScript strict mode
- No `any` types without justification
- Clear function names over comments
- Error handling at system boundaries

### Agent Soul Files
When modifying agent personality files (`src/templates/*/agents/*.md`):
- Keep the YAML frontmatter structure intact
- Use `{{company_name}}` placeholder — never hardcode company names
- Test that `parseAgentFile()` still parses correctly after changes

## Finding Issues
- Check [GitHub Issues](../../issues) for `good first issue` labels
- Template improvements and new agent personalities are great starter contributions
- Documentation improvements are always welcome

## License
By contributing, you agree to the [Contributor License Agreement](CLA.md). Your contributions will be licensed under the AGPL-3.0 License. See [LICENSING.md](LICENSING.md) for details.
