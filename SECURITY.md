# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AICIB, please report it responsibly.

**Email:** security@korvin.tech

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation plan within 7 days.

## Security Model

AICIB runs **entirely on your local machine**. There is no AICIB server or cloud service that handles your data.

- All state is stored locally in a SQLite database (`.aicib/state.db`)
- Configuration files (including API tokens) remain on your filesystem
- Agent operations delegate to the Claude API via the official Agent SDK
- The optional web dashboard runs on `localhost` only

### What AICIB Does NOT Do
- Does not transmit your data to any AICIB-operated server
- Does not store credentials in the cloud
- Does not open network ports beyond the local dashboard (when launched)

### User Responsibilities
- Keep your `aicib.config.yaml` private (it may contain Slack tokens)
- Do not commit `.aicib/` directories to public repositories
- Review agent actions when using autonomous/background mode

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
