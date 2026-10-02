# Cloudflare platform research for kiko (fetched 2026-10-02)

All numbers are quoted from official docs fetched on 2026-10-02 (markdown via `<url>/index.md`). Doc "Last updated" dates are noted where seen. UNVERIFIED = could not confirm in official docs.

Base: https://developers.cloudflare.com

## 1. Workers
Sources: /workers/platform/limits/ (updated 2026), /workers/platform/pricing/
| Item | Free | Paid ($5/mo min) |
|---|---|---|
| Requests | 100,000/day (resets 00:00 UTC; Error 1027 beyond) | 10 million/month included, +$0.30/million |
| CPU time per HTTP request | 10 ms | 30 s default, up to 5 min (limits.cpu_ms) |
| CPU billing | n/a | 30 million CPU-ms/month included, +$0.02/million CPU-ms |
| Subrequests per invocation | 50 | 10,000 (configurable up to 10M); internal services 1,000 on Free |
| Simultaneous open connections | 6 | 6 |
| Memory per isolate | 128 MB | 128 MB |
| Worker size | 64 MiB uncompressed (no compressed limit) | 64 MiB |
| Number of Workers | 100 | 500 |
| Cron triggers | 5 | 250 |
| Static assets files | 20,000 | 100,000 (25 MiB/file) |
| Wall-clock, HTTP | No limit while client connected | same |
| Wall-clock cron / DO alarm / queue consumer | 15 min | 15 min |
- Static assets: "Requests to static assets are free and unlimited." (pricing page footnote 3)
- "Cloudflare does not bill for subrequests you make from your Worker."
- WebSocket to a Worker is billed as one request (the upgrade); messages routed through a Worker are not requests.
- Each hop in a redirect chain counts against the subrequest limit.
- ctx.waitUntil extends execution up to 30 s after response/disconnect. Runtime updates give in-flight requests a 30 s grace period.

## 2. Durable Objects
Sources: /durable-objects/platform/pricing/ (updated Sep 30 2026), /durable-objects/platform/limits/ (Jun 1 2026), /durable-objects/concepts/durable-object-lifecycle/ (Sep 30 2026), /durable-objects/best-practices/websockets/, /durable-objects/api/alarms/
- Availability: Free AND Paid. Free = SQLite-backed only. Key-value backend only for accounts that already have a KV-backed namespace.
- Free: if any free limit exceeded, further operations of that type fail with an error. Daily limits reset 00:00 UTC.
| Item | Free | Paid |
|---|---|---|
| Requests | 100,000/day | 1M/month, +$0.15/million (HTTP, RPC sessions, WS messages, alarm invocations) |
| Duration | 13,000 GB-s/day | 400,000 GB-s/month, +$12.50/million GB-s |
| SQLite rows read | 5 million/day | 25 billion/month, +$0.001/million |
| SQLite rows written | 100,000/day | 50 million/month, +$1.00/million |
| SQL stored data | 5 GB total | 5 GB-month, +$0.20/GB-month |
| Classes per account | 100 | 500 |
| Storage per account | 5 GB | Unlimited |
| Storage per DO | doc FAQ says 1 GB on Free | 10 GB |
| Key+value / row / string size | 2 MB | 2 MB |
| WS message size | 32 MiB (received) | 32 MiB |
| CPU per request/WS message/alarm | 30 s default (Paid configurable to 5 min). Free: UNVERIFIED (page says Workers limits apply per plan, which suggests 10 ms) | 30 s default, 5 min max |
| Simultaneous outgoing connections | 6 | 6 |
| Soft throughput per DO | ~1,000 req/s | same |
- Duration is billed on 128 MB regardless of real usage (GB-s = seconds x 0.125).
- Billing note: storage billing for SQLite DOs was scheduled to start Jan 7 2026 (changelog /changelog/2025-12-12-durable-objects-sqlite-storage-billing/); the pricing page now lists it as active.
- WS billing: "a 20:1 ratio is applied to incoming WebSocket messages" (100 messages = 5 requests). Connection setup = 1 request. No charge for outgoing messages or protocol pings. setWebSocketAutoResponse replies cost no wall-clock and are not charged.
- RPC: each RPC session = 1 request; every RPC method call on a stub is its own session. Calls on a returned RpcTarget stub are part of the same session (not billed again).
- Alarms: alarm invocation counts as a request; each setAlarm() is billed as one row written. Deletes count as rows written. KV-style get/put/list on SQLite DO count as rows read/written.
- Duration while idle: "Durable Objects that are idle and eligible for hibernation are not billed for duration, even before the runtime has hibernated them." Billed while actively running or idle in memory but unable to hibernate. Calling accept() (non-hibernation API) bills for the whole connection. Hibernation API: no duration once handlers finish.
- Hibernation conditions (lifecycle page), ALL must hold: no setTimeout/setInterval callbacks; no pending I/O or waitUntil promise and no open outbound connection; no standard WebSocket API in use; no request/event in flight. After 10 s of inactivity in that state the DO hibernates.
- Idle non-hibernateable: evicted after 70-140 s of no incoming requests/events. BUT pending I/O (outbound fetch, RPC, service binding, waitUntil, timers, TCP, outbound WS) prevents eviction, each op for up to 15 min from its start (windows are per-operation, a later operation can extend). Duration is billed the whole time. Outbound WebSockets never hibernate.
- LLM streaming consequence: a DO awaiting/streaming an outbound fetch is billed for wall-clock the whole time (not hibernateable); 15 min per pending operation cap on eviction protection.
- Max WS connections per DO: UNVERIFIED (no number found in limits or websockets pages).
- Pricing examples (official): 100 DOs x 100 hibernating WS, 1 msg/min each, 10 ms/msg = $20.65/month total; 100 DOs with 1 msg/s always awake = $419.30.
- Shutdown: deploys/runtime updates restart DOs; WebSockets are terminated during shutdown; in-flight HTTP/RPC finish unless touching storage; no shutdown hooks (persist incrementally).

### Alarms (/durable-objects/api/alarms/, Apr 21 2026)
- One alarm per DO at a time; setAlarm overrides the existing one. Multiplex events yourself in storage (doc has an example).
- "guaranteed at-least-once execution", retried on uncaught exception with exponential backoff starting at 2 s, up to 6 retries (applies to the latest setAlarm only). alarm(alarmInfo) gets retryCount/isRetry. One alarm() runs at a time per DO. Catch errors and re-setAlarm for indefinite retry. Calling setAlarm in the constructor must check getAlarm first. Alarm wall time max 15 min.

## 3. D1
Sources: /d1/platform/pricing/, /d1/platform/limits/ (Apr 21 2026)
| | Free | Paid |
|---|---|---|
| Rows read | 5M/day | 25B/month, +$0.001/M |
| Rows written | 100,000/day | 50M/month, +$1.00/M |
| Storage | 5 GB total | 5 GB then $0.75/GB-mo |
| Max DB size | 500 MB | 10 GB |
| Databases | 10 | 50,000 |
| Queries per invocation | 50 | 1000 |
| Time travel | 7 d | 30 d |
| Max query duration | 30 s | 30 s |

## 4. R2 (/r2/pricing/, Oct 1 2026)
Standard: $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free. Free tier: 10 GB-month, 1M Class A, 10M Class B per month. Infrequent Access: $0.01/GB-mo, A $9.00/M, B $0.90/M, retrieval $0.01/GB. Deletes free. Whether R2 requires a payment method on Free: UNVERIFIED.

## 5. KV (/kv/platform/pricing/, /kv/platform/limits/, Apr 21 2026)
Free: 100,000 reads/day; 1,000 writes/day; 1,000 deletes/day; 1,000 lists/day; 1 GB. Paid: 10M reads/month +$0.50/M; 1M writes +$5/M; 1M deletes +$5/M; 1M lists +$5/M; 1 GB +$0.50/GB-mo. Value 25 MiB, key 512 B, metadata 1024 B; same-key writes 1/s; 1000 ops per invocation; min cacheTtl 30 s.

## 6. Queues (/queues/platform/pricing/, /queues/platform/limits/, Apr 21 2026)
- Available on Free. Free: 10,000 ops/day, retention 24 h fixed. Paid: 1M ops/month, +$0.40/M, retention 4 days default up to 14.
- Op = each 64 KB written/read/deleted, per message (not per batch); retries each cost a read.
- Limits: message 128 KB; retries 100; batch 100; sendBatch 100 msgs or 256 KB; batch wait 60 s; 5,000 msg/s per queue; backlog 25 GB; concurrent consumer invocations 250 (push); consumer wall 15 min; delay 24 h; 10,000 queues. Concurrency being plan-specific: UNVERIFIED (limits page says same for both plans except retention).

## 7. Vectorize / Workers AI
- Vectorize (/vectorize/platform/pricing/): Free 30M queried dims/month, 5M stored dims; Paid 50M queried (+$0.01/M), 10M stored (+$0.05/100M).
- Workers AI (/workers-ai/platform/pricing/): 10,000 Neurons/day free on both plans; Paid $0.011/1,000 Neurons above that; Free cannot exceed.

## 8. Outbound fetch / wall clock
- Workers limits: HTTP request duration "No limit" while the client stays connected; "no set time limit on individual subrequests". Wall-clock table (/workers/platform/limits/ "Wall time limits by invocation type"): DOs (RPC/HTTP) unlimited while caller connected; DOs remain active while request, RPC, response stream, WebSocket or pending I/O is in flight; alarms 15 min.
- DO stays alive during fetch: yes (see section 2), billed duration, per-op 15 min eviction-prevention window. Agents SDK doc (/agents/runtime/execution/durable-execution/) lists eviction reasons incl. 15 min alarm timeout and warns the upstream LLM connection is severed on eviction; offers keepAlive() (30 s alarm heartbeat) and runFiber() for recovery.
- Alarm semantics: see section 2.
- Runtime restarts can kill in-flight work (30 s grace).

## 9. HTMLRewriter / SSRF
- HTMLRewriter available in Workers (/workers/runtime-apis/html-rewriter/, Apr 23 2026); no plan restriction noted.
- fetch redirect option: "follow" (default), "error", "manual" (3xx returned as-is). Docs warn that with follow, all headers incl. Cookie/Authorization are forwarded to the redirect destination even cross-host (/workers/runtime-apis/fetch/ and request). Each redirect hop counts as a subrequest.
- Does Workers fetch refuse private/loopback IPs: official docs say NOTHING about it (UNVERIFIED). Community reports (not official; community.cloudflare.com thread 280797 returned 403 to my fetcher, only seen via search snippets) say fetching raw IPs often fails with error 1003 ("direct access to a Cloudflare IP address is not allowed", /support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1003/), which is not a guarantee of SSRF protection (DNS names resolving to private IPs, redirects). Do not rely on it: resolve/validate hostnames yourself where possible, reject IP literals and non-http(s), use redirect:"manual" and re-validate each hop, strip auth headers. Workers cannot reach a customer's private network without Tunnel/VPC bindings anyway (not researched).
- For model-written code, Dynamic Workers egress control: globalOutbound: null blocks all fetch()/connect(); or a WorkerEntrypoint gateway to inspect/allowlist (/dynamic-workers/usage/egress-control/, Sep 29 2026).

## 10. Cloudflare Agents SDK (npm `agents`)
Sources: https://developers.cloudflare.com/agents/ (Sep 18 2026), /agents/runtime/agents-api/, /agents/runtime/lifecycle/agent-class/, https://github.com/cloudflare/agents, npm registry.
- Version: agents 0.24.0 latest (published 2026-09-18), 649 published versions; still 0.x (pre-1.0). Repo MIT, ~5.7k stars, last push 2026-10-01.
- Agent class extends DurableObject. Provides: persistent state (cf_agents_state table, setState synced to all WS clients), @callable() RPC over WebSocket, SQL, scheduling (this.schedule delay/date/cron/interval; multiplexed over the single DO alarm via cf_agents_schedules table), built-in FIFO queue (cf_agents_queues), retries, durable fibers (runFiber/keepAlive), sub-agents (subAgent(), isolated storage, typed RPC), agents-as-tools, Workflows integration, MCP client and server (agents/mcp), email/voice/Slack/Telegram channels, Code Mode, sessions (tree-structured messages, compaction, FTS), AIChatAgent (@cloudflare/ai-chat, message persistence, resumable streaming), "Think" opinionated harness, routeAgentRequest URL routing /agents/:agent/:name, browser clients AgentClient, useAgent, useAgentChat (agents/react).
- Hibernation: README says agents hibernate when idle and wake on demand (DO hibernation).
- Dependencies: React and `ai` (Vercel AI SDK) are OPTIONAL peer deps (peerDependenciesMeta optional: ai, react, @ai-sdk/react, chat, vite, codemode...). Peer ranges: ai ^6||^7, react ^19, @ai-sdk/react ^3||^4. Core Agent + vanilla AgentClient work without React; AIChatAgent/useAgentChat path is built around the AI SDK. Hard deps include nanoid, partysocket, capnweb, cron-schedule, yaml, esbuild.
- Maturity: actively developed, pre-1.0, rapid API churn (many subpath exports); decorators (@callable) used.

## 11. Dynamic Workers / Worker Loader ("code mode")
Sources: /dynamic-workers/ (Apr 21 2026), /dynamic-workers/pricing/ (Jun 11 2026), /dynamic-workers/getting-started/, /dynamic-workers/usage/limits/ (Aug 27 2026). Old URL /workers/runtime-apis/bindings/worker-loader/ now redirects into this section.
- "Currently only available on the Workers Paid plan." Binding: wrangler `worker_loaders: [{binding:"LOADER"}]`; env.LOADER.load(code) or .get(id, cb).
- Pricing: 1,000 unique Dynamic Workers/month included, +$0.002 per Dynamic Worker per day beyond; requests and CPU billed at standard Workers rates. Unique = (ID, code) per day; use .get() with stable ID.
- Custom limits {cpuMs, subRequests}; default = plan limits. Bindings control access; globalOutbound null/gateway; Tail Workers for logs; DO Facets (dynamic code as a DO with isolated SQLite); Python needs python_workers flag.
- Agents SDK Code Mode (@cloudflare/codemode, /agents/tools/codemode/) builds on it.

## 12. Better Auth
Sources: https://better-auth.com/docs/concepts/cli, /docs/installation, /docs/concepts/database, /docs/integrations/hono, /docs/plugins/passkey, npm.
- better-auth latest 1.7.7. CLI package for docs is `auth` (`npx auth@latest ...`; bun: `bun x auth@latest`). `@better-auth/cli` is the old name (npm latest 1.4.21, last modified 2026-08-19, deprecated-style). Commands: generate, migrate, check, create-admin, init, upgrade, info, secret. So `bunx auth init` / `bun x auth@latest init` is real, but `init` options say only Next.js framework and SQLite database are supported, so it will not scaffold a Workers+D1 project. `generate` supports --adapter prisma|drizzle|kysely; `migrate` only for built-in Kysely adapter.
- D1: built-in; pass the binding directly: `betterAuth({ database: env.DB })` (docs "Example: Cloudflare D1", /docs/concepts/database). Kysely-based under the hood. Drizzle/Prisma adapters also possible (separate packages @better-auth/drizzle-adapter etc.). CLI cannot reach D1, so run `getMigrations(auth.options)` from `better-auth/db/migration` via an endpoint, or `generate` an SQL file and apply with wrangler d1.
- Workers caveats: needs `nodejs_compat` (or `nodejs_als`) because of AsyncLocalStorage, compat date 2024-09-23+. Env access: docs use `import { env } from "cloudflare:workers"`. Cloudflare bindings docs warn that objects built in global scope from bindings may persist across env changes (/workers/runtime-apis/bindings/), so a per-request instantiation factory is the safe pattern (that recommendation is my inference; Better Auth docs I read do not state "per-request" explicitly: UNVERIFIED). Secondary storage (KV) available for sessions/rate limits.
- Plugins: passkey = separate package `@better-auth/passkey` (SimpleWebAuthn); emailOTP plugin documented (/docs/plugins/email-otp); social providers (Google page exists /docs/authentication/google). You must supply the email sending function for OTP.
