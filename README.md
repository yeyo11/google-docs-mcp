# google-docs-mcp

[![CI](https://github.com/yeyo11/google-docs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/yeyo11/google-docs-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40yeyo11%2Fgoogle-docs-mcp)](https://www.npmjs.com/package/@yeyo11/google-docs-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2)](https://modelcontextprotocol.io)

A **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server for Google Docs.
Its job is to explain a document's **comments** to an AI assistant (Claude or any MCP client) in full detail:
who wrote each one, when, on which piece of text, whether it is open or resolved, the complete reply thread,
and who resolved it.

- **Read-only by design.** It only requests the `documents.readonly` and `drive.readonly` scopes. There is no tool
  that creates, edits, resolves or deletes anything, and every tool is advertised with `readOnlyHint: true`.
- **OAuth 2.0 sign-in.** Users authenticate with their own Google account through the desktop-app flow with PKCE.
  Tokens are stored locally and refreshed automatically.
- **Zero configuration for the assistant.** Tools accept a document ID *or* a full Google Docs URL.

## Tools

| Tool | What it does |
| --- | --- |
| `list_comments` | **The main tool.** Every comment in full detail: author, dates, open/resolved status, quoted text, the whole reply thread (including who resolved or reopened it) and, optionally, the paragraph of the document where the quoted text appears. Filter by status, include deleted comments, paginate, and choose `markdown` or `json` output. |
| `get_comments_summary` | Aggregate view: counts by status, participants and their activity, open comments with no replies, open comments waiting for the original author, oldest open comment and latest activity. |
| `get_comment` | A single comment thread by ID, with context. |
| `get_document` | Document metadata plus plain-text content (all tabs), so the assistant can understand what the comments refer to. |
| `list_documents` | Search Google Docs in Drive (shared drives included) by title or full text. |
| `get_auth_status` | Whether the server is signed in and with which account. |

### Example: `list_comments`

```markdown
# Q4 project plan
- Document ID: `1AbC...`
- Link: https://docs.google.com/document/d/1AbC.../edit
- Owner: Ana <ana@example.com>
- Last modified: 2026-09-22 08:00 UTC by Jose <jose@example.com> (you)

## Comments (all): 2

### [1] 🟢 OPEN — Ana <ana@example.com> · 2026-09-22 08:00 UTC

**Quoted text (what the comment refers to):**
> delivery date

**Surrounding paragraph (#7):**
> The delivery date will be shared with the client once the scope is final.

**Comment:**
The delivery date is missing.

_No replies yet._

Comment ID: `AAAAxyz`

### [2] ✅ RESOLVED — Ana <ana@example.com> · 2026-09-20 10:32 UTC
...
**Thread (2 replies):**
  - Jose <jose@example.com> (you) · 2026-09-21 09:00 UTC: Yes, moving it.
  - Jose <jose@example.com> (you) · 2026-09-21 12:00 UTC — marked as RESOLVED

Resolved by Jose <jose@example.com> (you) on 2026-09-21 12:00 UTC.
```

## Quick start

### Prerequisites

- Node.js >= 20
- A Google Cloud project with the **Google Drive API** and **Google Docs API** enabled

### 1. Create an OAuth client in Google Cloud

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. **APIs & Services → Library**: enable *Google Drive API* and *Google Docs API*.
3. **APIs & Services → OAuth consent screen**: configure it. Use *Internal* for a Workspace organization; for
   *External* apps in testing mode, add your account as a test user.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type **Desktop app**.
5. Download the JSON and save it as `~/.config/google-docs-mcp/credentials.json`.

You can use environment variables instead of the file:

```bash
export GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="..."
```

### 2. Sign in with Google

```bash
npx -y -p @yeyo11/google-docs-mcp google-docs-mcp-auth
```

Your browser opens (or the URL is printed so you can paste it). Google asks for **read-only** access to Drive and
Docs. Tokens are saved to `~/.config/google-docs-mcp/token.json` with `0600` permissions. Run the same command
again to switch accounts.

### 3. Register the server with your MCP client

No clone or build step is needed; `npx` fetches the package on first use.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "npx",
      "args": ["-y", "@yeyo11/google-docs-mcp"]
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add google-docs -- npx -y @yeyo11/google-docs-mcp
```

Any other MCP client that supports stdio servers works the same way. If you use environment variables for the OAuth
client, add them to the `env` block of your client configuration.

<details>
<summary>Running from source instead</summary>

```bash
git clone https://github.com/yeyo11/google-docs-mcp.git
cd google-docs-mcp
npm install
npm run build
npm run auth
```

Then point your MCP client at `node /absolute/path/to/google-docs-mcp/dist/index.js`.

</details>

### 4. Ask away

> "Summarize the open comments in https://docs.google.com/document/d/…/edit and tell me which ones are waiting on me."

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `GOOGLE_OAUTH_CREDENTIALS` | Path to the OAuth client JSON. | `~/.config/google-docs-mcp/credentials.json` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Alternative to the JSON file. | — |
| `GOOGLE_DOCS_MCP_TOKEN_PATH` | Where the user's tokens are stored. | `~/.config/google-docs-mcp/token.json` |
| `GOOGLE_DOCS_MCP_CONFIG_DIR` | Base directory for the two files above. | `~/.config/google-docs-mcp` |

## How it works

```
MCP client ──stdio──▶ google-docs-mcp ──OAuth2 (read-only)──▶ Google Drive API (files, comments)
                                                            └▶ Google Docs API (document text)
```

- Comments come from the Drive API (`comments.list` / `comments.get`) with every field requested explicitly, so
  nothing is silently dropped: quoted text, replies, `resolve`/`reopen` actions, deleted flags.
- The "surrounding paragraph" is found by locating the quoted text inside the document body fetched from the Docs
  API (all tabs are traversed, including tables).
- Google API errors (401/403/404/429) are returned as MCP `isError` results with an actionable message instead of
  breaking the session. Logs go to `stderr`; `stdout` is reserved for the protocol.

## Development

```bash
npm run dev        # run the server from src/ with tsx
npm run typecheck  # type-check without emitting
npm test           # smoke test: tool listing, error handling without credentials, comment formatting
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and commit conventions.

## Security

- Only read-only scopes are requested; Google never grants this client write access.
- If the stored token lacks the expected scopes, the server refuses to use it and asks you to sign in again.
- `credentials.json` and `token.json` are git-ignored. Never commit them.
- To revoke access, remove the app at <https://myaccount.google.com/permissions> and delete `token.json`.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Limitations (v0.1)

- Read-only: comments cannot be created, replied to or resolved.
- One Google account per installation (switch with `npm run auth`).
- The surrounding paragraph is located by searching for the quoted text; if that text was edited after the comment
  was made, it may not be found.

## Roadmap

- [ ] Optional write tools (reply, resolve) behind an explicit opt-in scope
- [ ] Multiple accounts / profiles
- [ ] Streamable HTTP transport for remote deployments

## License

[MIT](LICENSE)
