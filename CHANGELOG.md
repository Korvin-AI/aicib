# Changelog

All notable changes to AICIB will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-02-26

### Added
- CLI with 47 command paths across 11 feature areas
- Hierarchical agent system: CEO delegates to CTO, CFO, CMO via Claude Agent SDK
- Web dashboard (Next.js 16 + shadcn/ui + Tailwind v4) launched via `aicib ui`
- Slack integration for agent communication and chat
- Real-time cost tracking with configurable budgets and alerts
- SQLite-backed state management (22 tables)
- Setup wizard for guided company creation
- SaaS Startup template with pre-configured agent personas
- Background mode for long-running agent tasks
- Agent journal system for activity logging
- Hook system: context providers, message handlers, config extensions, table registry
- Multi-model engine abstraction
- Knowledge management and task management subsystems
- HR system for agent lifecycle management
- MCP (Model Context Protocol) integration support
