# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-11-06

### Fixed

- Sign-in messages, including `get_auth_status` and the server's instructions, gave `npm run auth`, which doesn't exist
  for someone running through npx. An installed package now names
  `npx -y -p @yeyo11/google-docs-mcp google-docs-mcp-auth`; a clone keeps `npm run auth`.
- The "not a Google Doc" check never fired, because `mimeType` wasn't requested from Drive. A bare ID of a Sheet, Slides
  deck or any other file is now refused by every tool that takes a document, including the comment tools, which used
  to let it through. `get_document` runs the check before calling the Docs API.

### Documentation

- README: External OAuth consent screens in Testing mode have to sign in again every seven days.
- README: comment and reply authors appear without an email address, as in Drive's API reference.
- README: a "Limits" section replaces "Limitations (v0.1)".

## [0.1.1] - 2026-11-01

### Added

- `mcpName` in `package.json` and a `server.json`, so the server can be published to the official
  [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.yeyo11/google-docs-mcp`.
- `glama.json`, so the maintainer can claim the server's listing on [Glama](https://glama.ai/mcp/servers).
- Published to npm as `@yeyo11/google-docs-mcp`, so the server runs with `npx -y @yeyo11/google-docs-mcp`
  and no clone/build step.
- Release workflow that publishes to npm with provenance whenever a GitHub release is published.

## [0.1.0] - 2026-09-23

### Added

- Read-only MCP server over stdio with six tools: `list_comments`, `get_comments_summary`, `get_comment`,
  `get_document`, `list_documents` and `get_auth_status`.
- OAuth 2.0 desktop sign-in flow (`npm run auth`) with PKCE, local token storage and automatic refresh.
- Detailed comment output: author, dates, status, quoted text, full reply threads with resolve/reopen actions,
  and optional surrounding paragraph from the document body.
- Comment summary: counts by status, participants, unanswered comments, comments awaiting the original author.
- Smoke test that runs without Google credentials.

[Unreleased]: https://github.com/yeyo11/google-docs-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/yeyo11/google-docs-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/yeyo11/google-docs-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yeyo11/google-docs-mcp/releases/tag/v0.1.0
