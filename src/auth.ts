import fs from "node:fs/promises";
import path from "node:path";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { CREDENTIALS_PATH, SCOPES, SERVER_NAME, TOKEN_PATH } from "./config.js";

export interface ClientSecrets {
  clientId: string;
  clientSecret: string;
}

export class AuthError extends Error {
  override name = "AuthError";
}

const AUTH_HINT =
  "Run `npm run auth` (or `google-docs-mcp-auth`) in a terminal to sign in with Google.";

/**
 * Loads client_id/client_secret from environment variables or from the JSON
 * downloaded from Google Cloud Console ("Desktop app" client type).
 */
export async function loadClientSecrets(): Promise<ClientSecrets> {
  const envId = process.env.GOOGLE_CLIENT_ID;
  const envSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret };
  }

  let raw: string;
  try {
    raw = await fs.readFile(CREDENTIALS_PATH, "utf8");
  } catch {
    throw new AuthError(
      `OAuth client credentials not found at ${CREDENTIALS_PATH}. ` +
        "Download the OAuth client JSON (Desktop app) from Google Cloud Console and place it there, " +
        "or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }

  const json = JSON.parse(raw) as Record<string, unknown>;
  const section = (json.installed ?? json.web ?? json) as Record<string, unknown>;
  const clientId = section.client_id;
  const clientSecret = section.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new AuthError(`${CREDENTIALS_PATH} does not contain client_id/client_secret.`);
  }
  return { clientId, clientSecret };
}

export async function readStoredTokens(): Promise<Credentials | null> {
  try {
    const raw = await fs.readFile(TOKEN_PATH, "utf8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: Credentials): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function createOAuthClient(secrets: ClientSecrets, redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
    ...(redirectUri ? { redirectUri } : {}),
  });
}

/** Required scopes that are missing from the granted scope string. */
export function missingScopes(granted: string | undefined | null): string[] {
  const set = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  return SCOPES.filter((s) => !set.has(s));
}

let cachedClient: Promise<OAuth2Client> | undefined;

/**
 * Returns an OAuth2Client backed by the persisted tokens.
 * Refreshed access tokens are written back to disk automatically.
 */
export function getAuthorizedClient(): Promise<OAuth2Client> {
  cachedClient ??= buildAuthorizedClient().catch((err) => {
    cachedClient = undefined; // allow a retry once the user has signed in
    throw err;
  });
  return cachedClient;
}

async function buildAuthorizedClient(): Promise<OAuth2Client> {
  const secrets = await loadClientSecrets();
  const stored = await readStoredTokens();
  if (!stored?.refresh_token) {
    throw new AuthError(`No stored Google credentials at ${TOKEN_PATH}. ${AUTH_HINT}`);
  }

  const missing = missingScopes(stored.scope);
  if (missing.length > 0) {
    throw new AuthError(
      `Stored credentials lack required read-only scopes (${missing.join(", ")}). ${AUTH_HINT}`,
    );
  }

  const client = createOAuthClient(secrets);
  client.setCredentials(stored);

  let current: Credentials = stored;
  client.on("tokens", (fresh) => {
    current = {
      ...current,
      ...fresh,
      refresh_token: fresh.refresh_token ?? current.refresh_token ?? null,
    };
    saveTokens(current).catch((err: unknown) => {
      console.error(`[${SERVER_NAME}] could not persist refreshed tokens:`, err);
    });
  });

  return client;
}
