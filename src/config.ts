import os from "node:os";
import path from "node:path";

/**
 * Read-only scopes. The server never requests write permissions; a stored token
 * that lacks any of these scopes is rejected by getAuthorizedClient().
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export const CONFIG_DIR =
  process.env.GOOGLE_DOCS_MCP_CONFIG_DIR ??
  path.join(os.homedir(), ".config", "google-docs-mcp");

/** OAuth client JSON (client_id/client_secret) downloaded from Google Cloud Console. */
export const CREDENTIALS_PATH =
  process.env.GOOGLE_OAUTH_CREDENTIALS ?? path.join(CONFIG_DIR, "credentials.json");

/** Where the user's OAuth tokens (access + refresh) are persisted. */
export const TOKEN_PATH =
  process.env.GOOGLE_DOCS_MCP_TOKEN_PATH ?? path.join(CONFIG_DIR, "token.json");

export const SERVER_NAME = "google-docs-mcp";
export const SERVER_VERSION = "0.1.0";
