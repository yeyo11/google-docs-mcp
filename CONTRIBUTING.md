# Contributing

Thanks for your interest in improving google-docs-mcp! Contributions of all kinds are welcome: bug reports,
feature requests, documentation fixes and pull requests.

## Ground rules

- **Keep it read-only.** Any tool that writes to Google (creating, replying to or resolving comments, editing
  documents) must be discussed in an issue first and, if accepted, live behind an explicit opt-in scope. Never
  widen the default OAuth scopes.
- **Never commit credentials.** `credentials.json` and `token.json` are git-ignored on purpose.
- **stdout belongs to MCP.** Use `console.error` for logs.

## Development setup

```bash
git clone https://github.com/yeyo11/google-docs-mcp.git
cd google-docs-mcp
npm install
npm run typecheck
npm test
```

`npm test` runs without Google credentials: it starts the server over stdio, lists the tools, checks that missing
credentials produce a clean `isError` result, and exercises the comment normalization/formatting with fixtures.

To test against real documents, follow the *Quick start* in the README and run `npm run dev`.

## Pull requests

1. Fork the repository and create a branch from `main`: `git checkout -b feat/my-change`.
2. Make your change. Match the surrounding code style (TypeScript strict mode, no `any`, explicit `fields` on every
   Google API call).
3. Run `npm run typecheck && npm test`.
4. Update the README if you changed a tool's name, parameters or output.
5. Open a pull request with a clear description of *what* and *why*.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add include_context option to list_comments
fix: handle documents with tabs when extracting text
docs: clarify OAuth consent screen setup
chore: bump googleapis
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump the version: `npm version <patch|minor|major>` (creates the commit and tag).
2. `git push --follow-tags`.
3. Publish a GitHub release for the tag. The *Publish to npm* workflow then publishes the package with provenance
   using the `NPM_TOKEN` repository secret. It can also be run manually from the Actions tab (`workflow_dispatch`).

## Reporting bugs

Open an issue with the tool you called, the arguments (redact document IDs if needed), the error text returned,
and your Node.js version. Never paste tokens or client secrets.
