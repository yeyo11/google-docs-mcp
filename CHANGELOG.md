# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-23

### Added

- Read-only MCP server over stdio with six tools: `list_comments`, `get_comments_summary`, `get_comment`,
  `get_document`, `list_documents` and `get_auth_status`.
- OAuth 2.0 desktop sign-in flow (`npm run auth`) with PKCE, local token storage and automatic refresh.
- Detailed comment output: author, dates, status, quoted text, full reply threads with resolve/reopen actions,
  and optional surrounding paragraph from the document body.
- Comment summary: counts by status, participants, unanswered comments, comments awaiting the original author.
- Smoke test that runs without Google credentials.

[Unreleased]: https://github.com/yeyo11/google-docs-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yeyo11/google-docs-mcp/releases/tag/v0.1.0
