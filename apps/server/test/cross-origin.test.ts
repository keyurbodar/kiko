import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Miniflare } from "miniflare"
import { signToken } from "../src/auth/auth"

// The production bundle with a page on another origin: the bearer token, the socket subprotocol,
// the file token, and CORS. The page's origin is not the Worker's, so none of it rides on a cookie.
const serverDir = new URL("..", import.meta.url).pathname
const SECRET = "test-secret-that-is-at-least-32-characters-long"
const CODE = "correct-horse-battery-staple"
const PAGE = "https://app.example.test"
const STRANGER = "https://evil.example.test"

let tmp: string
let mf: Miniflare
let origin: string
let token: string

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "kiko-cross-origin-"))
  await Bun.write(join(tmp, "assets", "index.html"), "app shell")
  const outdir = join(tmp, "production")
  const p = Bun.spawn(["bunx", "wrangler", "deploy", "--dry-run", "--outdir", outdir, "--assets", join(tmp, "assets")], {
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  if ((await p.exited) !== 0) throw new Error(`wrangler build failed\n${out}\n${err}`)
  const bundle = join(outdir, "index.js")
  const wasm = (await readdir(outdir)).filter((f) => f.endsWith(".wasm")).map((f) => ({ type: "CompiledWasm" as const, path: join(outdir, f) }))
  mf = new Miniflare({
    modules: [{ type: "ESModule", path: bundle }, ...wasm],
    modulesRoot: dirname(bundle),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    host: "localhost",
    port: 0,
    durableObjects: {
      OWNER: { className: "OwnerDO", useSQLite: true },
    },
    r2Buckets: ["FILES"],
    serviceBindings: { ASSETS: () => new Response("app shell") },
    bindings: { SESSION_SECRET: SECRET, ACCESS_CODE: CODE, TRUSTED_ORIGINS: PAGE },
  })
  origin = (await mf.ready).origin
  const res = await fetch(`${origin}/api/auth/access-code`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: PAGE },
    body: JSON.stringify({ code: CODE }),
  })
  token = ((await res.json()) as { token: string }).token
}, 120_000)

afterAll(async () => {
  await mf?.dispose()
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

const bearer = (t = token) => ({ authorization: `Bearer ${t}` })

describe("bearer", () => {
  test("an API call from the trusted page works with the header", async () => {
    const res = await fetch(`${origin}/api/me`, { headers: { ...bearer(), origin: PAGE } })
    expect(res.status).toBe(200)
  })

  test("the same call without the header is 401", async () => {
    expect((await fetch(`${origin}/api/me`, { headers: { origin: PAGE } })).status).toBe(401)
  })

  test("an expired token is 401", async () => {
    const old = await signToken(SECRET, "owner", "session", Date.now() - 31 * 24 * 60 * 60 * 1000)
    expect((await fetch(`${origin}/api/me`, { headers: bearer(old) })).status).toBe(401)
  })
})

describe("socket", () => {
  const open = (url: string, protocols: string[], headers: Record<string, string> = { origin: PAGE }) =>
    new Promise<{ ws: WebSocket; opened: boolean }>((resolve) => {
      const ws = new WebSocket(url, { protocols, headers } as never)
      ws.onopen = () => resolve({ ws, opened: true })
      ws.onerror = () => resolve({ ws, opened: false })
    })
  const wsUrl = () => `${origin.replace("http", "ws")}/api/ws`

  test("a valid subprotocol token opens the socket and the answer echoes the protocol", async () => {
    const { ws, opened } = await open(wsUrl(), ["kiko", token])
    expect(opened).toBe(true)
    expect(ws.protocol).toBe("kiko")
    ws.close()
  })

  test("the upgrade answers 101 with the echoed protocol, and 401 without a valid token", async () => {
    const upgrade = (protocol: string) =>
      fetch(`${origin}/api/ws`, { headers: { upgrade: "websocket", origin: PAGE, "sec-websocket-protocol": protocol, connection: "Upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } })
    const good = await upgrade(`kiko, ${token}`)
    expect(good.status).toBe(101)
    expect(good.headers.get("sec-websocket-protocol")).toBe("kiko")
    good.webSocket?.accept()
    good.webSocket?.close()
    expect((await upgrade("kiko")).status).toBe(401)
    expect((await upgrade(`kiko, ${token.replace(/.$/, token.endsWith("0") ? "1" : "0")}`)).status).toBe(401)
    expect((await upgrade(`other, ${token}`)).status).toBe(401)
  })

  test("an origin that is not trusted is refused even with a valid token", async () => {
    const { opened } = await open(wsUrl(), ["kiko", token], { origin: STRANGER })
    expect(opened).toBe(false)
  })

  test("the hello reply carries a file token that downloads a file", async () => {
    const put = await fetch(`${origin}/api/files/home?path=${encodeURIComponent("notes/a.txt")}`, {
      method: "PUT",
      headers: { ...bearer(), origin: PAGE, "content-type": "text/plain", "x-kiko-if-sha256": "none" },
      body: "cross origin bytes",
    })
    expect(put.status).toBe(200)
    const { file } = (await put.json()) as { file: { id: string } }

    const { ws } = await open(wsUrl(), ["kiko", token])
    const fileToken = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (ev) => {
        const frame = JSON.parse(String(ev.data)) as { fileToken?: string }
        if (frame.fileToken) resolve(frame.fileToken)
      }
      ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
      setTimeout(() => reject(new Error("no file token in the hello reply")), 5000)
    })
    ws.close()

    const url = `${origin}/api/files/home/${file.id}`
    const viaToken = await fetch(`${url}?t=${fileToken}`)
    expect(viaToken.status).toBe(200)
    expect(await viaToken.text()).toBe("cross origin bytes")
    expect((await fetch(url)).status).toBe(401)
  })
})

describe("file token", () => {
  test("it reads a download and nothing else", async () => {
    const fileToken = await signToken(SECRET, "owner", "files")
    expect((await fetch(`${origin}/api/me?t=${fileToken}`)).status).toBe(401)
    expect((await fetch(`${origin}/api/me`, { headers: bearer(fileToken) })).status).toBe(401)
    const upload = await fetch(`${origin}/api/files/home?path=x.txt&t=${fileToken}`, {
      method: "PUT",
      headers: { "content-type": "text/plain", "x-kiko-if-sha256": "none" },
      body: "nope",
    })
    expect(upload.status).toBe(401)
    expect((await fetch(`${origin}/api/ws?t=${fileToken}`, { headers: { upgrade: "websocket" } })).status).toBe(401)
  })

  test("it lasts an hour and then stops working", async () => {
    const fresh = await signToken(SECRET, "owner", "files")
    expect((await fetch(`${origin}/api/files/home/missing?t=${fresh}`)).status).toBe(404)
    const stale = await signToken(SECRET, "owner", "files", Date.now() - 61 * 60 * 1000)
    expect((await fetch(`${origin}/api/files/home/missing?t=${stale}`)).status).toBe(401)
    const left = Number(fresh.split(".")[2]) - Date.now() / 1000
    expect(left).toBeGreaterThan(49 * 60)
    expect(left).toBeLessThanOrEqual(60 * 60)
  })

  test("the token route gives a fresh file token to the bearer and to nobody else", async () => {
    expect((await fetch(`${origin}/api/files/token`)).status).toBe(401)
    expect((await fetch(`${origin}/api/files/token?t=${await signToken(SECRET, "owner", "files")}`)).status).toBe(401)
    const res = await fetch(`${origin}/api/files/token`, { headers: { ...bearer(), origin: PAGE } })
    expect(res.status).toBe(200)
    const { fileToken } = (await res.json()) as { fileToken: string }
    expect((await fetch(`${origin}/api/files/home/missing?t=${fileToken}`)).status).toBe(404)
  })

  test("a session token is not a file token", async () => {
    expect((await fetch(`${origin}/api/files/home/missing?t=${token}`)).status).toBe(401)
  })
})

describe("cors", () => {
  const preflight = (from: string, headers = "authorization, content-type, range") =>
    fetch(`${origin}/api/files/home?path=a`, {
      method: "OPTIONS",
      headers: { origin: from, "access-control-request-method": "PUT", "access-control-request-headers": headers },
    })

  test("a preflight from the trusted page is allowed", async () => {
    const res = await preflight(PAGE)
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGE)
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization")
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("range")
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT")
    expect(res.headers.get("vary")).toContain("Origin")
    expect(res.headers.get("access-control-allow-credentials")).toBeNull()
  })

  test("a preflight from an untrusted origin gets no allow-origin header", async () => {
    const res = await preflight(STRANGER)
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
    expect(res.headers.get("access-control-allow-methods")).toBeNull()
  })

  test("an answer to the trusted page names the origin and exposes the range headers", async () => {
    const res = await fetch(`${origin}/api/me`, { headers: { ...bearer(), origin: PAGE } })
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGE)
    expect(res.headers.get("access-control-expose-headers")).toContain("Content-Range")
    expect(res.headers.get("vary")).toContain("Origin")
  })

  test("an answer to an untrusted origin has no allow-origin header", async () => {
    const res = await fetch(`${origin}/api/me`, { headers: { ...bearer(), origin: STRANGER } })
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("a same-origin call gets no CORS headers", async () => {
    const res = await fetch(`${origin}/api/me`, { headers: bearer() })
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })
})
