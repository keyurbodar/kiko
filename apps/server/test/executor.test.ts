import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// P7-03. The real `UserDO` runs in workerd. Executor Cloud v2 is faked here, through
// Miniflare's outbound service, with the endpoints experiment 8 saw: protected resource
// metadata, authorization server metadata, dynamic registration, a token endpoint that
// checks PKCE and rotates refresh tokens, and an MCP endpoint that answers `tools/list`
// only for the current access token. Like v2, it keeps a paused program in the MCP session
// that ran it. The browser step is the test reading the authorize URL and minting a code for
// its challenge.

const MCP = "https://v2.executor.sh/mcp"
const AS = "https://v2.executor.sh/api/auth"
const SCOPES = ["mcp", "offline_access"]
const CALLBACK = "/api/integrations/executor/callback"

const fake = {
  clients: new Map<string, string[]>(),
  codes: new Map<string, { challenge: string; redirect: string; client: string }>(),
  access: new Set<string>(),
  refresh: new Set<string>(),
  issued: [] as string[],
  grants: [] as string[],
  expiresIn: 3600,
  refreshDelayMs: 0,
  rejectRefresh: false,
  bearers: [] as string[],
  /** Open MCP sessions, and the session each paused program waits in. */
  sessions: new Set<string>(),
  paused: new Map<string, string>(),
  /** `initialize` requests, one per session opened. */
  opened: 0,
}
let n = 0

function issue() {
  const id = `${++n}-${crypto.randomUUID()}`
  const access = `at-${id}`
  const refresh = `rt-${id}`
  fake.access.add(access)
  fake.refresh.add(refresh)
  fake.issued.push(access, refresh)
  return { access_token: access, token_type: "Bearer", expires_in: fake.expiresIn, refresh_token: refresh }
}

async function s256(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return Buffer.from(digest).toString("base64url")
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function executor(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const at = `${url.origin}${url.pathname}`
  if (at === "https://v2.executor.sh/.well-known/oauth-protected-resource/mcp") {
    return json({ resource: MCP, authorization_servers: [AS], scopes_supported: SCOPES })
  }
  if (at === `${AS}/.well-known/oauth-authorization-server` || at === "https://v2.executor.sh/.well-known/oauth-authorization-server/api/auth") {
    return json({
      issuer: AS,
      authorization_endpoint: `${AS}/oauth2/authorize`,
      token_endpoint: `${AS}/oauth2/token`,
      registration_endpoint: `${AS}/oauth2/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      scopes_supported: SCOPES,
    })
  }
  if (at === `${AS}/oauth2/register` && request.method === "POST") {
    const body = (await request.json()) as { redirect_uris: string[] }
    const client = `client-${fake.clients.size + 1}`
    fake.clients.set(client, body.redirect_uris)
    return json({ ...body, client_id: client }, 201)
  }
  if (at === `${AS}/oauth2/token` && request.method === "POST") {
    const form = new URLSearchParams(await request.text())
    const grant = form.get("grant_type")!
    fake.grants.push(grant)
    if (grant === "authorization_code") {
      const code = fake.codes.get(form.get("code") ?? "")
      fake.codes.delete(form.get("code") ?? "")
      const ok =
        code &&
        code.client === form.get("client_id") &&
        code.redirect === form.get("redirect_uri") &&
        code.challenge === (await s256(form.get("code_verifier") ?? ""))
      return ok ? json(issue()) : json({ error: "invalid_grant" }, 400)
    }
    if (grant === "refresh_token") {
      if (fake.refreshDelayMs) await Bun.sleep(fake.refreshDelayMs)
      const old = form.get("refresh_token") ?? ""
      if (fake.rejectRefresh || !fake.refresh.delete(old)) return json({ error: "invalid_grant" }, 400)
      return json(issue())
    }
    return json({ error: "unsupported_grant_type" }, 400)
  }
  if (at === MCP) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
    fake.bearers.push(bearer)
    if (!fake.access.has(bearer) && !bearer.startsWith("exk-")) {
      return new Response("unauthorized", {
        status: 401,
        headers: { "www-authenticate": `Bearer resource_metadata="https://v2.executor.sh/.well-known/oauth-protected-resource/mcp?elicitation_mode=model", scope="mcp offline_access"` },
      })
    }
    const session = request.headers.get("mcp-session-id") ?? ""
    if (request.method === "DELETE") {
      fake.sessions.delete(session)
      for (const [id, s] of fake.paused) if (s === session) fake.paused.delete(id)
      return new Response(null, { status: 200 })
    }
    if (request.method !== "POST") return new Response(null, { status: 405 })
    // Like any streamable HTTP server, a session it does not know answers 404.
    if (session && !fake.sessions.has(session)) return new Response("session not found", { status: 404 })
    const msg = (await request.json()) as { id?: number; method: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } }
    if (msg.id === undefined) return new Response(null, { status: 202 })
    if (msg.method === "initialize") {
      fake.opened++
      const id = `s-${crypto.randomUUID()}`
      fake.sessions.add(id)
      return Response.json(
        { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } },
        { headers: { "mcp-session-id": id } },
      )
    }
    if (msg.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "execute", inputSchema: { type: "object" } }] } })
    }
    if (msg.method === "tools/call") {
      const text = (value: unknown) => json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } })
      if (msg.params?.name === "execute" && msg.params.arguments?.code === "return 1") return text({ status: "completed", execution: { ok: true, value: 1 } })
      if (msg.params?.name === "execute") {
        const requestId = `apr_${crypto.randomUUID().slice(0, 8)}`
        fake.paused.set(requestId, session)
        return text({ status: "approval-required", requestId, invocation: {}, elicitation: { mode: "form", message: "Approve send?", requestedSchema: { type: "object", properties: {} } }, expiresAt: Date.now() + 900_000 })
      }
      if (msg.params?.name === "resume") {
        const requestId = String(msg.params.arguments?.requestId ?? "")
        // A program resumes only in the session that paused it (v2's caller check).
        if (fake.paused.get(requestId) !== session) return text({ status: "unavailable", requestId })
        fake.paused.delete(requestId)
        return text({ status: "completed", execution: { ok: true, result: "sent" } })
      }
    }
    return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } })
  }
  return new Response("not found", { status: 404 })
}

let mf: Miniflare
let output = ""
let origin = ""

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./executor-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { CREDENTIALS_KEK: `kek-${crypto.randomUUID()}` },
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
    outboundService: executor,
    handleRuntimeStdio(stdout, stderr) {
      stdout.on("data", (chunk) => (output += String(chunk)))
      stderr.on("data", (chunk) => (output += String(chunk)))
    },
  })
  origin = (await mf.ready).origin
})

afterAll(async () => {
  await mf?.dispose()
})

let users = 0
const fresh = () => `exec${++users}${crypto.randomUUID().slice(0, 6)}`

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

type Frame = { t: string; reqId?: string; result?: any }

async function socket(user: string) {
  const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${user}`)
  const frames: Frame[] = []
  ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
  let req = 0
  async function wait(test: (f: Frame) => boolean, ms = 5000) {
    const end = Date.now() + ms
    for (;;) {
      const found = frames.find(test)
      if (found) return found
      if (Date.now() > end) throw new Error(`no frame. got ${JSON.stringify(frames)}`)
      await Bun.sleep(10)
    }
  }
  async function ask(frame: Record<string, unknown>) {
    const reqId = `r${++req}`
    ws.send(JSON.stringify({ ...frame, reqId }))
    return (await wait((f) => f.t === "executor" && f.reqId === reqId)).result
  }
  return { frames, ask, wait, close: () => ws.close() }
}

/** The browser step: read the authorize URL, approve, and land on the callback. */
async function approve(user: string, authorizeUrl: string, tamper: Partial<{ state: string }> = {}) {
  const q = new URL(authorizeUrl).searchParams
  const code = `code-${crypto.randomUUID()}`
  fake.codes.set(code, { challenge: q.get("code_challenge")!, redirect: q.get("redirect_uri")!, client: q.get("client_id")! })
  const back = new URL(q.get("redirect_uri")!)
  back.searchParams.set("code", code)
  back.searchParams.set("state", tamper.state ?? q.get("state")!)
  back.searchParams.set("iss", AS)
  const res = await mf.dispatchFetch(back, { headers: { "x-test-user": user } })
  return { status: res.status, text: await res.text() }
}

async function connected(user: string) {
  const ws = await socket(user)
  const started = await ws.ask({ t: "connectExecutor" })
  expect(started.ok).toBe(true)
  const page = await approve(user, started.authorizeUrl)
  expect(page.status).toBe(200)
  return ws
}

test("connect starts a pkce sign-in with offline_access and a callback on this origin", async () => {
  const user = fresh()
  const ws = await socket(user)
  const before = fake.clients.size
  const result = await ws.ask({ t: "connectExecutor" })
  expect(result.ok).toBe(true)
  const url = new URL(result.authorizeUrl)
  expect(`${url.origin}${url.pathname}`).toBe(`${AS}/oauth2/authorize`)
  expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  expect(url.searchParams.get("scope")?.split(" ")).toContain("offline_access")
  expect(url.searchParams.get("redirect_uri")).toBe(`${origin}${CALLBACK}`)
  expect(url.searchParams.get("resource")).toBe(MCP)
  expect(fake.clients.size).toBe(before + 1)
  expect(result.status).toMatchObject({ connected: false, pending: true, kind: null })

  // A second start reuses the registration and makes a new verifier and state.
  const again = await ws.ask({ t: "connectExecutor" })
  expect(fake.clients.size).toBe(before + 1)
  const q2 = new URL(again.authorizeUrl).searchParams
  expect(q2.get("code_challenge")).not.toBe(url.searchParams.get("code_challenge"))
  expect(q2.get("state")).not.toBe(url.searchParams.get("state"))
  ws.close()
})

test("the callback stores sealed tokens, tells every socket, and lists tools", async () => {
  const user = fresh()
  const ws = await connected(user)
  const told = await ws.wait((f) => f.t === "executor" && f.reqId === undefined)
  expect(told.result.status).toMatchObject({ connected: true, kind: "oauth", pending: false, refreshable: true })

  const raw = (await rpc(user, "rawExecutorRows")) as { name: string; ciphertext: string }[]
  expect(raw.map((r) => r.name)).toEqual(["oauth", "redirect"])
  for (const secret of fake.issued) for (const r of raw) expect(r.ciphertext).not.toContain(secret)

  const listed = await ws.ask({ t: "executorStatus", tools: true })
  expect(listed).toMatchObject({ ok: true, tools: ["execute"] })
  ws.close()
})

test("a callback with a wrong state or for another user stores nothing", async () => {
  const alice = fresh()
  const bob = fresh()
  const ws = await socket(alice)
  const started = await ws.ask({ t: "connectExecutor" })
  const forged = await approve(alice, started.authorizeUrl, { state: "forged" })
  expect(forged.status).toBe(400)
  expect(forged.text).toContain("state does not match")
  // Bob's session cannot finish Alice's sign-in: his object has no sign-in waiting.
  const crossed = await approve(bob, started.authorizeUrl)
  expect(crossed.status).toBe(400)
  const noSession = await mf.dispatchFetch(`http://do${CALLBACK}?code=x&state=y`)
  expect(noSession.status).toBe(401)
  expect((await ws.ask({ t: "executorStatus" })).status.connected).toBe(false)
  const bobWs = await socket(bob)
  expect((await bobWs.ask({ t: "executorStatus" })).status).toMatchObject({ connected: false, rows: 0 })
  ws.close()
  bobWs.close()
})

test("a forced refresh rotates the tokens and the new token works", async () => {
  const user = fresh()
  const ws = await connected(user)
  const first = (await ws.ask({ t: "executorStatus" })).status
  await Bun.sleep(5)
  const refreshed = await ws.ask({ t: "executorStatus", refresh: true, tools: true })
  expect(refreshed.ok).toBe(true)
  expect(refreshed.status.issuedAt).toBeGreaterThan(first.issuedAt)
  expect(refreshed.tools).toEqual(["execute"])
  expect(fake.bearers.at(-1)).toBe(fake.issued.at(-2)!)
  ws.close()
})

test("a token close to expiry is refreshed once for concurrent callers", async () => {
  fake.expiresIn = 30
  try {
    const user = fresh()
    const ws = await connected(user)
    const before = fake.grants.filter((g) => g === "refresh_token").length
    fake.refreshDelayMs = 100
    const tokens = await Promise.all([rpc(user, "executorToken"), rpc(user, "executorToken"), rpc(user, "executorToken")])
    expect(fake.grants.filter((g) => g === "refresh_token").length).toBe(before + 1)
    expect(new Set(tokens).size).toBe(1)
    expect(fake.access.has(tokens[0])).toBe(true)
    ws.close()
  } finally {
    fake.expiresIn = 3600
    fake.refreshDelayMs = 0
  }
})

test("a refused refresh token asks for a new sign-in", async () => {
  const user = fresh()
  const ws = await connected(user)
  fake.rejectRefresh = true
  try {
    const result = await ws.ask({ t: "executorStatus", refresh: true })
    expect(result).toEqual({ ok: false, error: "executor needs a new sign-in" })
    expect((await ws.ask({ t: "executorStatus" })).status).toMatchObject({ connected: false, pending: false })
  } finally {
    fake.rejectRefresh = false
  }
  ws.close()
})

test("disconnect deletes every row, even while a refresh is in flight", async () => {
  const user = fresh()
  const ws = await connected(user)
  fake.refreshDelayMs = 200
  try {
    const refreshing = ws.ask({ t: "executorStatus", refresh: true })
    await Bun.sleep(50)
    const gone = await ws.ask({ t: "disconnectExecutor" })
    expect(gone.status).toMatchObject({ connected: false, kind: null, rows: 0 })
    await refreshing
  } finally {
    fake.refreshDelayMs = 0
  }
  expect(await rpc(user, "rawExecutorRows")).toEqual([])
  expect((await ws.ask({ t: "executorStatus" })).status).toMatchObject({ connected: false, rows: 0 })
  expect(await rpc(user, "executorToken")).toBeNull()
  const tools = await ws.ask({ t: "executorStatus", tools: true })
  expect(tools).toEqual({ ok: false, error: "executor is not connected" })
  ws.close()
})

test("a pasted api key replaces oauth, is sent as the bearer, and never comes back", async () => {
  const user = fresh()
  const ws = await connected(user)
  const key = `exk-${crypto.randomUUID()}`
  const saved = await ws.ask({ t: "connectExecutor", apiKey: key })
  expect(saved.status).toMatchObject({ connected: true, kind: "api_key", rows: 1 })
  expect(JSON.stringify(saved)).not.toContain(key)
  expect((await ws.ask({ t: "executorStatus", tools: true })).tools).toEqual(["execute"])
  expect(fake.bearers.at(-1)).toBe(key)
  expect((await ws.ask({ t: "connectExecutor", apiKey: "  " })).ok).toBe(false)
  expect((await ws.ask({ t: "disconnectExecutor" })).status.rows).toBe(0)
  ws.close()
})

test("no token or key reaches the log", async () => {
  await Bun.sleep(100)
  expect(output.length).toBeGreaterThan(0)
  for (const secret of fake.issued) expect(output).not.toContain(secret)
  expect(output).not.toContain("exk-")
})

test("a paused program resumes in the session that paused it, which stays open until then", async () => {
  const user = fresh()
  const ws = await connected(user)
  const paused = (await rpc(user, "executorCall", "execute", { code: "send it" })) as { content: { text: string }[] }
  const pending = JSON.parse(paused.content[0]!.text) as { status: string; requestId: string }
  expect(pending.status).toBe("approval-required")
  const session = fake.paused.get(pending.requestId)!
  expect(fake.sessions.has(session)).toBe(true)

  const done = (await rpc(user, "executorCall", "resume", { requestId: pending.requestId, response: { action: "accept", content: {} } })) as { content: { text: string }[] }
  expect(JSON.parse(done.content[0]!.text)).toMatchObject({ status: "completed" })
  ws.close()
})

test("calls share one session instead of opening one each", async () => {
  const user = fresh()
  const ws = await connected(user)
  await rpc(user, "executorTools")
  const before = fake.opened
  for (let i = 0; i < 3; i++) {
    const out = (await rpc(user, "executorCall", "execute", { code: "return 1" })) as { content: { text: string }[] }
    expect(JSON.parse(out.content[0]!.text)).toMatchObject({ status: "completed" })
  }
  await rpc(user, "executorTools")
  expect(fake.opened).toBe(before)
  ws.close()
})

test("a session executor forgot is opened again, and the call runs once", async () => {
  const user = fresh()
  const ws = await connected(user)
  await rpc(user, "executorCall", "execute", { code: "return 1" })
  const before = fake.opened
  fake.sessions.clear()
  const out = (await rpc(user, "executorCall", "execute", { code: "return 1" })) as { content: { text: string }[] }
  expect(JSON.parse(out.content[0]!.text)).toMatchObject({ status: "completed" })
  expect(fake.opened).toBe(before + 1)
  ws.close()
})
