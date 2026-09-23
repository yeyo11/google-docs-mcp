# Security Policy

## Scope

google-docs-mcp requests only read-only Google scopes (`documents.readonly`, `drive.readonly`) and stores OAuth
tokens locally in the user's config directory with `0600` permissions. The server exposes no network listener; it
communicates with the MCP client over stdio. The only listener ever opened is a temporary loopback HTTP server on
`127.0.0.1` during `npm run auth`, which shuts down as soon as the authorization code is received.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*). You will receive an acknowledgement within a few days, and a fix or
mitigation will be coordinated with you before any public disclosure.

When reporting, include the affected version, a description of the issue and, if possible, steps to reproduce.
Never include real OAuth tokens or client secrets in a report.

## Supported versions

Only the latest release on `main` receives security fixes.
