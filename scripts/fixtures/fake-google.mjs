/**
 * Preloaded with `node --import` into a server under test: answers Google's token and Drive endpoints locally, so the
 * real auth library and error path run with no network and no Google account. Only the refresh token "valid" works;
 * any other gets invalid_grant, as an expired or revoked token does.
 */
const realFetch = globalThis.fetch;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fakeFetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return new URLSearchParams(String(init?.body)).get("refresh_token") === "valid"
      ? json(200, { access_token: "fake", expires_in: 3600 })
      : json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/about")) {
    return json(200, { user: { displayName: "Ana", emailAddress: "ana@example.com" } });
  }
  if (url.includes("googleapis.com")) throw new Error(`fake-google: unexpected request to ${url}`);
  return realFetch(input, init);
};

// gaxios, under google-auth-library, uses node-fetch unless a `window` exists: this is its way to take another fetch.
globalThis.window = { fetch: fakeFetch };
