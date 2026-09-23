#!/usr/bin/env node
/**
 * OAuth 2.0 flow for desktop applications (loopback redirect + PKCE).
 * Opens the browser, receives the authorization code on
 * http://127.0.0.1:<port>/oauth2callback and stores the tokens at TOKEN_PATH.
 * Only read-only scopes are requested.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { CodeChallengeMethod } from "google-auth-library";
import { google } from "googleapis";
import { createOAuthClient, loadClientSecrets, missingScopes, saveTokens } from "./auth.js";
import { SCOPES, TOKEN_PATH } from "./config.js";

const CALLBACK_PATH = "/oauth2callback";

function tryOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // If the browser cannot be opened the user copies the URL manually.
  }
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}</style></head>
<body><h1>${title}</h1><p>${body}</p></body></html>`;
}

async function main(): Promise<void> {
  const secrets = await loadClientSecrets();

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

  const client = createOAuthClient(secrets, redirectUri);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  if (!codeChallenge) throw new Error("Could not generate a PKCE code challenge.");
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces Google to issue a refresh_token
    scope: [...SCOPES],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  console.log("Requesting READ-ONLY access to Google Docs and Google Drive.\n");
  console.log("Open this URL in your browser if it does not open automatically:\n");
  console.log(`  ${authUrl}\n`);
  tryOpenBrowser(authUrl);

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const receivedState = url.searchParams.get("state");
      const receivedCode = url.searchParams.get("code");

      if (error) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Authorization failed", `Google returned: ${error}`));
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }
      if (receivedState !== state || !receivedCode) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Invalid request", "State mismatch or missing code."));
        reject(new Error("OAuth state mismatch or missing authorization code"));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(htmlPage("Signed in", "google-docs-mcp is authorized (read-only). You can close this tab."));
      resolve(receivedCode);
    });
  }).finally(() => server.close());

  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke the app at https://myaccount.google.com/permissions and run auth again.",
    );
  }
  const missing = missingScopes(tokens.scope);
  if (missing.length > 0) {
    throw new Error(`Granted scopes are incomplete; missing: ${missing.join(", ")}`);
  }

  await saveTokens(tokens);
  client.setCredentials(tokens);

  const drive = google.drive({ version: "v3", auth: client });
  const about = await drive.about.get({ fields: "user(displayName,emailAddress)" });
  const user = about.data.user;

  console.log(`Signed in as ${user?.displayName ?? "?"} <${user?.emailAddress ?? "?"}>`);
  console.log(`Tokens saved to ${TOKEN_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
