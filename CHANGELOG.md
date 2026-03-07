# Changelog

All notable changes to AICIB will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-03-07

### Added
- **Setup wizard redesign**: replaced 4-step wizard (company → team → budget → review) with 4-step conversational flow (company info → business context → goals → launch)
- **Document upload**: drag-and-drop file import (.pdf, .docx, .md, .txt) with text extraction into wiki
- **Website scraping**: Firecrawl-powered URL scraping saves landing page content as wiki article
- **Business profile**: 10-question interview stored as structured wiki article for agent context
- **7-day plans**: challenge-specific plans for Growth, Marketing, Product, Operations, Funding, and Team Building
- **File dropzone component**: reusable drag-and-drop with validation (10 files, 10MB each)

### Changed
- Wizard now collects business context before launch instead of manual agent/budget configuration
- Business creation API accepts profile and 7-day plan, saves both as wiki articles

### Fixed
- **Firecrawl SDK v4 compatibility**: updated from `FirecrawlApp.scrapeUrl()` to `FirecrawlClient.scrape()` (SDK broke with v4 API changes)
- Dead `mammoth.convertToHtml()` call removed from DOCX extraction (only `extractRawText` was used)
- Failed file uploads now show warning in UI instead of silently succeeding
- Added 3 missing 7-day plans (Operations, Funding, Team Building) that fell through to generic default
- Removed stale `@types/pdf-parse` (v2 ships its own types)
- Added `session_id` column migration safety in `ensureWikiTable` for older databases
- Added URL validation in scrape route (reject non-http/https URLs)

## [0.2.0] - 2026-03-07

### Added
- **Knowledge auto-capture**: agents automatically capture and register knowledge during sessions
- Knowledge CLI commands for manual management
- Agent persona templates updated with knowledge capture instructions
- Knowledge page improvements in web UI

### Changed
- Knowledge register supports session-scoped slug tracking
- Agent runner integrates knowledge capture hooks

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
