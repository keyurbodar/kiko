# Experiment 8: Executor Cloud OAuth

Status: PARTLY SETTLED. Discovery and dynamic client registration are proven. The sign-in, token exchange, and `tools/list` are UNVERIFIED because they need a human Executor account.

Run on 2026-10-02. No account was created and no token was obtained.

## Proven

- `POST https://executor.sh/mcp` without a token returns 401 with `WWW-Authenticate: Bearer resource_metadata="https://executor.sh/.well-known/oauth-protected-resource/mcp"`.
- The protected resource names one authorization server, `https://signin.executor.sh` (WorkOS AuthKit).
- Its metadata offers PKCE `S256` only, `token_endpoint_auth_method` `none`, `client_secret_post`, `client_secret_basic`, grants `authorization_code`, `refresh_token`, device code, and scopes `openid profile email offline_access`.
- It advertises `registration_endpoint` `https://signin.executor.sh/oauth2/register` and `client_id_metadata_document_supported: true`.
- Dynamic client registration is open. A public client (`token_endpoint_auth_method: none`, name `kiko`, a localhost redirect uri) got HTTP 201 and a `client_id`. No secret is issued for a public client.
- A Worker route using `@earendil-works/pi-mcp` (`apps/server/src/experiments/executor-oauth.ts`) ran discovery and registration itself and answered `/start` with a 302 to `/oauth2/authorize` carrying `code_challenge_method=S256`, `scope=openid profile email offline_access`, `prompt=consent`, and `resource=https://executor.sh/mcp`.

- P7-03, 2026-10-02: the production flow in `UserDO` (`apps/server/src/integrations/executor/connect.ts`) registered client `client_01M3XZJZ...` for `http://localhost:8873/api/integrations/executor/callback`. `/oauth2/authorize` answered 302 to `https://signin.executor.sh/?authorization_session_id=...`, and a headless browser showed Executor's "Sign in" page (email, Google, GitHub). Nobody signed in.

## UNVERIFIED (needs the owner)

- That the consent screen after sign-in accepts the dynamically registered client. The sign-in page accepts it.
- That the code exchange returns an access token the MCP endpoint accepts.
- Access-token lifetime, and whether a refresh token arrives with `offline_access`.
- The tool names returned by `tools/list`.
- Whether a registered client with a deployed `https` redirect uri behaves like the localhost one.

## Flow to prove

1. Start the Worker: `bunx wrangler dev --port 8787`.
2. Create an Executor Cloud account at https://executor.sh (human step).
3. Open `http://localhost:8787/api/experiments/executor-oauth/start` in a browser and approve.
4. The callback page prints tools, `accessTokenLifetimeSeconds`, and `refreshTokenReceived`. No token is shown.
5. Run `bun kiko executor probe` and paste its output below.

State is held in one isolate's memory, so keep the same `wrangler dev` process between steps 3 and 5. Production keeps it encrypted in `UserDO`.

## Fallback

If the consent step rejects the dynamic client, use a personal API key for Executor Cloud and record that the API-key path is the only one. UNVERIFIED: the key's header format.

## Result

Tools seen: not yet run.

## Owner sign-in result (2026-10-02)

The owner signed in to Executor Cloud and approved kiko's dynamically registered client. `bun kiko verify executor-connect` passed in 161 s against local `wrangler dev`:

- The consent screen accepted the registered public client, and the code exchange returned a token the MCP endpoint accepts.
- Access token lifetime: 86,400 s (24 hours).
- `tools/list` returned: `execute`, `skills`, `resume`, `create-artifact`, `edit-artifact`, `list-artifacts`, `show-artifact`.

Kiko must still read tool names at run time and never hard-code them.
