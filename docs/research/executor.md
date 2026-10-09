# Executor (executor.sh) research notes for yuki

Researched 2026-10-02. Sources: docs site (https://executor.sh/docs, llms.txt, .md pages), repo clone of
https://github.com/UsefulSoftwareCo/executor at commit 98d606b (2026-09-30), GitHub API, DeepWiki (cross-checked
against source), and live unauthenticated probes of executor.sh. Paths below are repo paths unless a URL is given.
Anything not confirmed is marked UNVERIFIED.

Note: the docs link to github.com/RhysSullivan/executor; the repo lives at UsefulSoftwareCo/executor (GitHub API
returns full_name UsefulSoftwareCo/executor). Docker image is ghcr.io/rhyssullivan/executor-selfhost.

## 1. What it is, and its forms
"Open-source integration layer for AI agents: one catalog for every tool, shared across every agent"
(https://executor.sh/docs/index.md). Configure integrations once (MCP servers, OpenAPI, GraphQL), with auth and
per-tool policies, expose them as ONE MCP endpoint (https://executor.sh/docs/mcp-proxy.md).

Forms (https://executor.sh/docs/index.md): CLI (`npm i -g executor`, Node 20+, local HTTP runtime, web UI at
127.0.0.1:4788, MCP at http://127.0.0.1:4788/mcp, https://executor.sh/docs/local/cli.md); Desktop app (same runtime,
Mac/Win/Linux); Executor Cloud (hosted, free tier, https://executor.sh/docs/hosted/cloud.md); Self-host Docker
(single container, SQLite, QuickJS sandbox, first signup becomes owner, single org, /mcp;
https://executor.sh/docs/hosted/docker.md); Self-host Cloudflare Worker (single-tenant, D1, Cloudflare Access auth;
https://executor.sh/docs/hosted/cloudflare.md). Docs say all forms expose the same functionality.
Differences that matter: local/self-host are single-org, creds stay on your machine; Cloud is multi-tenant (WorkOS
AuthKit auth, org-scoped URLs, API keys) and is the only one with the OAuth discovery described in section 3
(apps/cloud/src/mcp/*). Self-host Docker/CF auth is session / Cloudflare Access, not the cloud OAuth flow.
The Cloud docs page itself publishes NO endpoint URL, auth details or limits; everything in section 3 comes from source
and live probes.

## 2. Terminology
- Integration: an MCP server, OpenAPI spec or GraphQL endpoint; describes a tool catalog, not a live auth'd link
  (https://executor.sh/docs/concepts/integrations.md). Adding via UI "Add Source" (CLI page says "source" too); the
  CLI uses `executor call executor openapi addSource` and `executor tools sources`. Both words are in use:
  "integration" (docs/API: GET /integrations) and "source" (CLI/UI legacy).
- Connection: configured instance of an integration; many per integration; may be unauthenticated; credentials are
  stored by Executor and never visible to the agent sandbox (concepts/connections.md). REST: /connections,
  /connections/:owner/:integration/:name (packages/core/api/src/connections/api.ts). `owner` is "org" or "user"
  (see the `integrations` tool schema, packages/hosts/mcp/src/tool-server.ts ~L1290), i.e. a connection can be shared
  org-wide or personal. Tool address inside sandbox: `tools.<integration>.<owner>.<connection>.<tool>`
  (packages/core/execution/src/skills.ts L57).
- Policy: docs say Allow / Require approval / Block (https://executor.sh/docs/concepts/policies.md). Code enum is
  "approve" | "require_approval" | "block" (packages/core/sdk/src/policies.ts L340). Defaults derive from the spec
  (OpenAPI GET allowed, writes can require approval). Scoped to an owner; most restrictive across owners wins
  (packages/core/api/src/policies/api.ts header comment).
- Secrets: stored by Executor, encrypted (plugins: encrypted-secrets, workos-vault, keychain, onepassword,
  file-secrets under packages/plugins/). Cloud uses workos-vault (packages/plugins/workos-vault). Detailed secret
  model UNVERIFIED beyond that.
- Scopes/workspaces/orgs: no "workspace" concept found. Cloud is organization-based (WorkOS orgs; slug in URL
  /<org-slug>/mcp). Docs mention nothing about "workspaces". Toolkits: `/mcp/toolkits/:slug` named tool subsets
  (apps/cloud/src/mcp/auth.ts; packages/plugins/toolkits); no public docs on them (UNVERIFIED semantics).
  OAuth scopes advertised: openid profile email offline_access.

## 3. Connecting an MCP client to Executor Cloud (KEY QUESTION)
Endpoint shapes (apps/cloud/src/mcp/mount.ts L46-58, auth.ts L40-82):
- https://executor.sh/mcp (bare; org taken from token org_id claim)
- https://executor.sh/<org-slug>/mcp (org pinned; legacy org id `org_xxx` also accepted; re-checked against
  membership each request, "a selector, not a trust boundary")
- https://executor.sh/mcp/toolkits/<slug> and /<org>/mcp/toolkits/<slug>
Transport: streamable HTTP (docs say "streamable-HTTP MCP endpoint", cli.md/docker.md; cloud served by a Durable
Object agent handler apps/cloud/src/mcp/agent-handler.ts, session-durable-object.ts, session-id via mcp-session-id
header). Query-param options on the URL (packages/hosts/mcp/src/browser-approval.ts):
`?elicitation_mode=browser|model|native` (default model), `?mode=passthrough` (default codemode),
`?search_tools=true`, `?artifacts=false`.

Auth (apps/cloud/src/mcp/auth.ts L267-353, auth-provider.ts): every /mcp request needs `Authorization: Bearer ...`.
Token is either:
 (a) a WorkOS AuthKit OAuth JWT (3 dot-separated parts), verified against JWKS at
     https://signin.executor.sh/oauth2/jwks; or
 (b) a user-owned API key (non-JWT string), validated via WorkOS (ApiKeyService, auth/api-keys.ts).
     ORG-owned API keys are REJECTED for MCP ("Organization API keys cannot open an MCP session"). Personal keys are
     created in the console: REST POST /api/account/api-keys (packages/core/api/src/account/api.ts L203), bound to a
     member + org.
Missing token -> 401 with `WWW-Authenticate: Bearer resource_metadata="https://executor.sh/.well-known/oauth-protected-resource/mcp"`.

LIVE-VERIFIED (curl, 2026-10-02):
- GET https://executor.sh/.well-known/oauth-protected-resource/mcp ->
  {"resource":"https://executor.sh/mcp","authorization_servers":["https://signin.executor.sh"],
   "bearer_methods_supported":["header"],"scopes_supported":["openid","profile","email","offline_access"]}
- GET https://executor.sh/.well-known/oauth-authorization-server (proxied from AuthKit): issuer
  https://signin.executor.sh, authorization_endpoint /oauth2/authorize, token_endpoint /oauth2/token,
  registration_endpoint https://signin.executor.sh/oauth2/register (dynamic client registration),
  code_challenge_methods_supported ["S256"], grant types authorization_code, refresh_token, device_code,
  device_authorization_endpoint, client_id_metadata_document_supported true, token_endpoint_auth_methods none /
  client_secret_post / client_secret_basic.
- POST https://executor.sh/mcp unauthenticated -> 401 + the WWW-Authenticate above.
- GET https://executor.sh/api/account/me unauthenticated -> 401.

Answer for yuki: YES, a third-party server-side app can get a per-user credential, two ways:
1. OAuth 2.1 authorization-code + PKCE (S256) with RFC 7591 dynamic client registration (or CIMD), standard MCP
   authorization flow: discover protected-resource metadata -> AS metadata -> POST registration_endpoint with
   yuki's redirect_uri (e.g. https://yuki.example/oauth/executor/callback) -> redirect the user to
   authorization_endpoint (user logs in at signin.executor.sh and picks org) -> exchange code at token_endpoint ->
   store access + refresh token per user (request offline_access so a refresh token is issued; the server comment says
   clients without it "silently sign out at every access-token expiry"). Then call POST/GET/DELETE
   https://executor.sh/<org-slug>/mcp with Bearer. All of this is plain fetch, fine from a Worker; MCP TypeScript
   SDK's OAuth client provider or `agents` MCP client can drive it. The repo's own e2e helper mints a bearer this way
   (e2e/src/surfaces/mcp.ts per DeepWiki; I did not read that file myself: UNVERIFIED line-level). Access-token TTL
   UNVERIFIED (AuthKit config).
2. Paste-in personal API key: the user creates a personal API key in the Executor console and gives it to yuki;
   yuki sends it as Bearer. Simplest, no refresh, but key lifetime/expiry/format UNVERIFIED, user must copy secret,
   and the key is user-scoped so it acts as that member.
Also usable: the REST API (section 6) with the same bearer (cloud resolves "api-key/session"; JWT bearer on /api
supported via auth/api-jwt-bearer.ts, exact acceptance of MCP-audience JWTs on /api UNVERIFIED).
Redirect URI allow-listing/ whether AuthKit DCR is enabled for arbitrary redirect URIs: the metadata advertises it and
Claude/ChatGPT/Cursor use it per docs; actually registering from yuki was NOT tested (UNVERIFIED, would need a write
to their AuthKit, so I did not do it).

## 4. MCP tools exposed
Default mode "codemode" (packages/hosts/mcp/src/tool-server.ts L2051-2200). Small fixed set, NOT one tool per upstream
operation:
- `execute` input `{ code: string (trimmed, min 1) }`. Description: "Execute TypeScript in a sandboxed runtime." plus a
  dynamic "## Available integrations" list of up to 50 integration slugs
  (packages/core/execution/src/description.ts). Code runs in QuickJS (WASM) sandbox; TypeScript types stripped before
  run (skills.ts L65). Inside the sandbox: `tools.search({query, namespace?, limit?, offset?})` ->
  `{items,total,hasMore,nextOffset}`; `tools.describe.tool({path})` -> `inputTypeScript`, `outputTypeScript`,
  `typeScriptDefinitions`; `tools.executor.coreTools.connections.list({})`; call tools as
  `tools.<integration>.<owner>.<connection>.<tool>(args)` (packages/core/execution/src/skills.ts L35-65).
  So yes: "code mode" where the model writes TypeScript.
- `skills` input `{ name?: string }`; read-only docs about this server's tools (e.g. name "execute"), keeps the
  `execute` description small.
- `resume` (unless elicitation_mode=native). Shape depends on mode, see section 5.
- Optional `search_<integration>` (one per connected integration, up to 50, input `{query?: string}`), only with
  `?search_tools=true`.
- Artifact/UI tools (default on; disable `?artifacts=false`): `execute-action` {code, artifactId?},
  `execute-action-resume` {executionId, action, content?}, plus artifact create/edit tools and a `ui://` MCP-Apps shell
  resource (tool-server.ts ~L2600-2830; I did not enumerate all artifact tool names: UNVERIFIED). yuki should pass
  `?artifacts=false` since it is not an MCP-Apps host.
Alternative `?mode=passthrough` (tool-server.ts L1285-1460, passthrough-tools.ts): serves `integrations`
({integration?, owner?: "org"|"user", ...paging}), `search` ({query,...filters}; returns tool IDs, account details and FULL
JSON input schemas), `invoke` ({tool: string, arguments: Record<string,unknown>}, annotated destructiveHint=true,
"Your client handles approval for this call; workspace blocks remain enforced"), and `skills`. No `execute`/`resume`.
This is the closest fit for yuki if yuki wants to expose upstream operations to its own agent loop as discrete
tool calls without a code sandbox. Exact full descriptions are in source; the schemas above are abridged.

## 5. Approvals
Per-connection elicitation mode chosen by URL query (browser-approval.ts), default `model`:
- model (default): `execute` returns a normal tool result (structuredContent + text) "Execution paused: ..." with
  `executionId`, instructions, optional requestedSchema (form), URL (url elicitation) or approval terms and
  deadline. The agent/host must ask the human, then call `resume` {executionId, action: "accept"|"decline"|"cancel",
  content: JSON string (default "{}"), persist?: string (one of interaction.meta.persist, remember approval)}
  (packages/core/execution/src/engine.ts L213-275; tool-server.ts L2102-2140). No MCP elicitation capability needed:
  yuki just renders an approve/deny UI and calls `resume`. Paused execution lease in cloud: 4 minutes
  (PAUSED_APPROVAL_TIMEOUT_MS, tool-server.ts L350; used in apps/cloud/src/mcp/session-durable-object.ts L414).
  Auth-needed pauses use URL elicitation (user opens a URL, then resume accept).
- browser: `execute` returns "User approval required" + approvalUrl
  `https://executor.sh/<org-slug>/resume/<executionId>?mcp_session_id=<id>`; user approves while signed in to the
  console; the `resume` tool {executionId} long-polls for the decision. Model cannot choose accept/decline.
- native: no `resume` tool; server sends standard MCP `elicitation/create` (form/url) during the tool call; client must
  declare the elicitation capability and answer. Needs a held-open streaming request.
Implementation needed in yuki for `model` mode: parse paused results, persist executionId against the chat turn,
surface UI, call `resume` within 4 minutes, handle decline/cancel and `persist`. Also REST equivalents:
GET /executions/:id, POST /executions, POST /executions/:id/resume (packages/core/api/src/executions/api.ts).

## 6. Other surfaces
- MCP resources: capabilities declared `{ resources: {}, tools: {} }` (tool-server.ts L1654); only `ui://` shell
  resource found. No prompts capability found (UNVERIFIED absence). tool-list-changed notifications: code reconciles
  tools on session restore; whether notifications/tools/list_changed is emitted on catalog change UNVERIFIED. Since
  tool surface is fixed (execute/skills/resume), yuki mostly does not need it.
- REST API: mounted under /api on cloud (apps/cloud/src/app-paths.ts; 401 unauthenticated verified live). Effect HttpApi
  groups in packages/core/api/src: GET/POST /connections, GET/PATCH/DELETE /connections/:owner/:integration/:name,
  /connections/:..../refresh|health, /connections/validate; GET/POST /policies, PATCH/DELETE /policies/:policyId;
  GET /integrations, /integrations/:slug, POST /integrations/detect; GET /tools, /tools/schema; /executions (above);
  /oauth/clients, /oauth/start|complete|cancel|probe|callback (connection OAuth); /account/me, /account/api-keys,
  /account/org-api-keys, /account/members...; /artifacts, /admin. No published REST docs found: UNVERIFIED stability;
  org-level API keys are read-only on the REST platform view (execution-stack-middleware.ts).
- SDK: packages/core/sdk, examples/promise-sdk, examples/docs-sdk-quickstart (in-process embeddable SDK; not a cloud
  client; UNVERIFIED whether it can target Cloud).
- Webhooks: only inbound WorkOS webhook (/api/webhooks/workos) for their own mirror. No outbound webhooks found.
- Connecting upstream accounts happens in the Executor console/OAuth (/oauth/*); yuki cannot avoid sending the user
  there for first-time connection setup (or drive /api/oauth/start with a user token: UNVERIFIED redirect handling).

## 7. Pricing/limits (https://executor.sh/pricing.md)
Free $0: up to 3 members, 100,000 executions/month, unlimited integrations. Team $15/member/month (14-day trial),
unlimited executions, verified domains. Enterprise: custom, SSO/SAML, audit logs, dedicated/self-hosted. Source also
mentions a "free-organization limit" (apps/cloud/CHANGELOG.md 1.4.70) - count UNVERIFIED. Rate limits UNVERIFIED.
An "execution" presumably = one `execute` call (UNVERIFIED). Each yuki user would use their own org/plan.
Contact on pricing page: rhys@executor.sh.

## 8. License and maturity
MIT (LICENSE; GitHub API). 4,034 stars, 340 forks, 183 open issues, created 2026-02-07, pushed 2026-10-02
(GitHub API). Very active (2,938+ commits). Releases: v1.6.4..v1.6.10 between 2026-08-30 and 2026-09-18; then
executor@2.0.0-beta.0 (2026-09-23), beta.4 (09-27), beta.5 (09-29), beta.7 (10-01) - a 2.0 rewrite beta is underway
(releases via GitHub API). Cloud package at 1.4.71; host-mcp 1.4.4. The tool surface already changed in this window
(passthrough mode, artifacts, search_<integration>, elicitation modes). Expect breaking changes.
Docs are thin (10 pages); detail lives only in code. Cloud MCP API surface is not documented as a stable contract.

## 9. Risks for a multi-tenant server-side consumer
1. Undocumented contract: cloud endpoint, discovery and API keys are only in source; docs say nothing. 2.0 beta in
   flight; tool names/schemas may change. Pin behaviours via `?mode=passthrough`/`?elicitation_mode=model` and add
   contract tests against a test account.
2. Token handling: per-user refresh tokens (and any API keys) are high-value secrets; encrypt at rest in the DO, scope
   per user, refresh single-flight (DO is a natural lock). Dynamic client registration creates a client at AuthKit;
   registration limits UNVERIFIED.
3. Approvals are session-bound and short: paused executions live in the user's MCP session Durable Object with a 4-minute
   lease; an agent turn that outlives the user's attention loses the pause. Reconnecting with a new mcp-session-id
   loses it too (UNVERIFIED how restore works across sessions).
4. Prompt injection / safety: upstream tool results flow into yuki's model; policy "approve" tools run without a
   human. Surface Executor's own policies, and do not auto-accept `resume` on the model's behalf (model mode lets the
   model call resume itself: yuki must gate accept/decline on the human, not the LLM).
5. Cost/limits: 100k executions/month free cap per org; per-user org billing is the user's, but a failing cap breaks
   agents silently. Latency: extra hop plus QuickJS execution, search-then-describe-then-call means several round trips
   in code mode.
6. Code-mode model fit: requires models good at writing sandbox TypeScript; passthrough mode gives per-call tools but
   returns full JSON schemas.
7. Dependency/ownership: single small vendor (Useful Software Co / Rhys Sullivan), startup risk; MIT lets us fork/self-host
   as a fallback (Cloudflare Worker host exists: apps/host-cloudflare, single-tenant).
8. Session semantics: Streamable-HTTP sessions with `mcp-session-id`; from a Worker use fresh fetch per request or a DO to
   hold the session; long-lived SSE needed only for native elicitation.
9. Data residency / secrets: users' third-party credentials live at Executor; yuki never sees them (a plus), but yuki's
   audit trail depends on Executor's (audit logging is Enterprise only).
10. UNVERIFIED items above (DCR from arbitrary redirect URIs, token TTLs, tools/list_changed, REST bearer acceptance)
   should be tested with a real account before committing.
