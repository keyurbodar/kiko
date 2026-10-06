# Executor v2 research notes for kiko

Researched 2026-10-06. Sources: the repo at tag `executor@2.0.0-beta.8` (commit e1c4f01, 2026-10-02), the npm package `@executor-js/sdk@2.1.0-beta.0`, Effect's `McpServer` source on GitHub, and unauthenticated GET probes of the public discovery URLs. Paths are repo paths unless a URL is given. v1 facts are in [executor.md](executor.md).

## 1. What v2 is

v2 is a new codebase, not an upgrade of v1. Its model:

- A **provider** is a service and its auth methods. An **account** is a saved credential for one (v1's connection).
- An **app** is TypeScript a user writes or imports (`defineApp`). Imported MCP, OpenAPI, and GraphQL servers become apps. A **deployment** is an immutable build of an app.
- A **tool** is a query or a mutation in an app's router, called as `tools.<app>.<path>` inside `execute`.
- **Approval** is declared per tool in code (`always()`, `never()`, or a function). v1's policy table is gone.
- New: profiles (account selection per owner), skills, workflows, schedules, webhooks, and per-app SQLite data.

## 2. It cannot run inside kiko's Durable Objects on the Free plan

- App tools run in Worker Loader isolates on every host (`packages/sdk/src/implementation/app-runner.ts:1-8`). Worker Loader (Dynamic Workers) is not on the Free plan.
- The in-process SDK (`createExecutor`) is `"private": true` (`packages/sdk/package.json:3`). The published `@executor-js/sdk@2.1.0-beta.0` is only an HTTP client for `platform.executor.sh` (its README, and `createRemoteExecutor` in its dist).
- Every host stores its control plane in Postgres (`makeExecutorStorage({ provider: "postgresql" })` in `apps/hosted/server/src/implementation/database.ts:64` and the self-host and local hosts). There is no D1 or Durable Object SQLite adapter.
- v2's own cloud runs on Durable Objects (MCP sessions, app data, schedules), with Postgres as the source of truth (`apps/hosted/cloud/src/infrastructure/executor.ts:4`). That is Executor's deployment, not something a host can embed.

## 3. The hosted v2 MCP server

Probed on 2026-10-06:

- `https://v2.executor.sh/mcp` answers 401 with `resource_metadata=".../oauth-protected-resource/mcp?elicitation_mode=model"` and `scope="mcp offline_access"`. That metadata names the plain resource `https://v2.executor.sh/mcp`.
- The authorization server metadata is served at both `https://v2.executor.sh/.well-known/oauth-authorization-server/api/auth` and `https://v2.executor.sh/api/auth/.well-known/oauth-authorization-server`.
- `https://v2.executor.sh/.well-known/oauth-protected-resource/mcp` names the authorization server `https://v2.executor.sh/api/auth` and the scopes `mcp` and `offline_access`.
- `https://executor.sh/.well-known/oauth-protected-resource/mcp` still names `https://signin.executor.sh` with the v1 scopes. The executor.sh that kiko uses is still v1.
- v2 is a separate account system. A v1 account and its integrations do not carry over (inferred from the separate hosts, UNVERIFIED).

What changes for a client:

| | v1 | v2 |
| --- | --- | --- |
| MCP URL | `https://executor.sh/mcp` | `https://v2.executor.sh/mcp` |
| Issuer | `https://signin.executor.sh` | `https://v2.executor.sh/api/auth` |
| Scope | `openid profile email offline_access` | `mcp offline_access` |
| Tools | `execute`, `resume`, or passthrough tools | `execute`, `resume`, `skills` (`packages/mcp/src/contracts/tools.ts:17`) |
| Query options | `mode`, `artifacts`, `elicitation_mode` | `elicitation_mode` only: `model`, `native`, `browser` |
| Code language | TypeScript | JavaScript, run by `@opencode-ai/codemode`, a pure interpreter |
| Paused result | text carrying `executionId` | JSON: `{status: "approval-required" or "input-required", requestId, elicitation, expiresAt, ...}` |
| Resume input | `{executionId, action, content}` | `{requestId, response: {action, content?}}` |
| Hold time | 4 minutes | 15 minutes |

- A tool result is sent as JSON text with the same object in `structuredContent` (Effect `McpServer`, `packages/effect/src/unstable/ai/McpServer.ts` on GitHub main). UNVERIFIED: that the pinned snapshot Executor uses does the same.
- Limits per `execute`: 64 KB of code, 100 tool calls, 5 minutes, 64 KB of output (`packages/mcp/src/contracts/execute.ts`).

## 4. A paused program lives in one MCP session

- The program waits in memory, owned by its caller: the user, client, organization, and grant, plus the elicitation mode and the `mcp-session-id` header (`packages/mcp/src/implementation/server.ts:162`, `apps/hosted/server/src/implementation/mcp-http.ts:107`). A `resume` from another session finds nothing and returns `unavailable` (`packages/mcp/src/implementation/executions.ts:458-461`).
- A restart of Executor's server loses it. The docs list resuming after a restart as later work (`apps/docs/content/mcp.md:106`).
- pi-mcp 1.0.0 cannot reuse a session: it takes no session id, and `close()` sends `DELETE` (`dist/transports/streamable-http.js:197-207`). Kiko v1's code opened and closed a session per call, which would lose every paused program. Kiko now keeps the session of a paused program open until it is resumed (architecture section 12.3).
- UNVERIFIED: whether the hosted server issues an `mcp-session-id` at all. If it does not, every request falls back to the same `"stateless"` key and a new session would still find the program.

## 5. What this means for kiko

- `bun kiko verify executor-connect` part one passed against v2 on 2026-10-06: dynamic registration with a localhost redirect URI, PKCE S256, the scopes `mcp offline_access`, and a redirect to Executor's sign-in page.

- Embedding v2 in kiko's objects is blocked by the plan and by the unpublished SDK. Paying for Workers would unlock Worker Loader but not the other two.
- kiko can use hosted v2 over MCP as it uses v1. The work is a new host, issuer, and scope, the structured paused result, the new `resume` input, a 15-minute card, and keeping one MCP session from `execute` to `resume`.
- `elicitation_mode=browser` would let the human approve on Executor's own page, which needs the human signed in to Executor in that browser. `model` mode keeps kiko's approval card.
- `@opencode-ai/codemode` is a pure JavaScript interpreter with a `workerd` build. It could serve kiko's own code mode later, apart from Executor.
