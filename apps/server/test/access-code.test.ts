import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Miniflare } from "miniflare"
import { signToken } from "../src/auth/auth"

// The production bundle, with and without the ACCESS_CODE secret. The sign-in method is not dev-only,
// so both tests run against a deploy build.
const serverDir = new URL("..", import.meta.url).pathname
const CODE = "correct-horse-battery-staple"
const SECRET = "test-secret-that-is-at-least-32-characters-long"

let tmp: string
let bundlePath: string
const workers: Miniflare[] = []

async function build(): Promise<string> {
  const outdir = join(tmp, "production")
  const env = { ...process.env, NODE_ENV: "production" }
  const p = Bun.spawn(
    ["bunx", "wrangler", "deploy", "--dry-run", "--outdir", outdir, "--assets", join(tmp, "assets")],
    { cwd: serverDir, env, stdout: "pipe", stderr: "pipe" },
  )
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  if ((await p.exited) !== 0) throw new Error(`wrangler build failed\n${out}\n${err}`)
  return join(outdir, "index.js")
}

async function start(bindings: Record<string, string>): Promise<string> {
  const wasm = (await readdir(dirname(bundlePath)))
    .filter((f) => f.endsWith(".wasm"))
    .map((f) => ({ type: "CompiledWasm" as const, path: join(dirname(bundlePath), f) }))
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: bundlePath }, ...wasm],
    modulesRoot: dirname(bundlePath),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    host: "localhost",
    port: 0,
    durableObjects: {
      OWNER: { className: "OwnerDO", useSQLite: true },
    },
    serviceBindings: { ASSETS: () => new Response("app shell") },
    bindings: { SESSION_SECRET: SECRET, ...bindings },
  })
  workers.push(mf)
  return (await mf.ready).origin
}

function signIn(origin: string, body: unknown) {
  return fetch(`${origin}/api/auth/access-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "kiko-access-code-"))
  await Bun.write(join(tmp, "assets", "index.html"), "app shell")
  bundlePath = await build()
}, 120_000)

afterAll(async () => {
  await Promise.all(workers.map((mf) => mf.dispose()))
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

const tokenOf = async (res: Response) => ((await res.json()) as { token: string }).token
const me = (origin: string, token: string) => fetch(`${origin}/api/me`, { headers: { authorization: `Bearer ${token}` } })

describe("with ACCESS_CODE set", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start({ ACCESS_CODE: CODE })
  })

  test("the right code returns a token that /api/me accepts as the owner, and sets no cookie", async () => {
    const res = await signIn(origin, { code: CODE })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([])
    const answer = await me(origin, await tokenOf(res))
    expect(answer.status).toBe(200)
    expect(((await answer.json()) as { user: { id: string } }).user.id).toBe("owner")
  })

  test("a wrong code answers 401 with the fixed message and no token", async () => {
    const res = await signIn(origin, { code: "not-the-code" })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { message: string; token?: string }
    expect(body.message).toBe("That access code is not right")
    expect(body.token).toBeUndefined()
  })

  test("a missing code answers 401, not a server error", async () => {
    expect((await signIn(origin, {})).status).toBe(401)
  })

  test("a token with a tampered owner id, expiry, or mac is refused, and a request with none is too", async () => {
    const token = await tokenOf(await signIn(origin, { code: CODE }))
    const [id, scope, expiry, mac] = token.split(".") as [string, string, string, string]
    const flip = (hex: string) => hex.replace(/^./, hex[0] === "0" ? "1" : "0")
    expect((await me(origin, token)).status).toBe(200)
    expect((await me(origin, `other.${scope}.${expiry}.${mac}`)).status).toBe(401)
    expect((await me(origin, `${id}.${scope}.${Number(expiry) + 1}.${mac}`)).status).toBe(401)
    expect((await me(origin, `${id}.${scope}.${expiry}.${flip(mac)}`)).status).toBe(401)
    expect((await me(origin, "garbage")).status).toBe(401)
    expect((await fetch(`${origin}/api/me`)).status).toBe(401)
  })

  test("a token past its expiry is refused, and a file token is not a session token", async () => {
    const expired = await signToken(SECRET, "owner", "session", Date.now() - 31 * 24 * 60 * 60 * 1000)
    expect((await me(origin, expired)).status).toBe(401)
    expect((await me(origin, await signToken(SECRET, "owner", "files"))).status).toBe(401)
    expect((await me(origin, await signToken(SECRET, "owner", "session"))).status).toBe(200)
  })

  test("a session token lasts thirty days", async () => {
    const token = await tokenOf(await signIn(origin, { code: CODE }))
    const left = Number(token.split(".")[2]) - Date.now() / 1000
    expect(left).toBeGreaterThan(29.9 * 24 * 60 * 60)
    expect(left).toBeLessThanOrEqual(30 * 24 * 60 * 60)
  })
})

describe("a new account", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start({ ACCESS_CODE: CODE })
  })

  test("signing in makes the pinned Kiko chat before any /api/me call, so the first socket lists it", async () => {
    const token = await tokenOf(await signIn(origin, { code: CODE }))
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/api/ws`, ["kiko", token])
    const first = new Promise<{ t: string; snapshot?: { chats: { title: string; pinned: boolean; kiko?: boolean }[] } }>((resolve, reject) => {
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
      ws.onmessage = (e) => resolve(JSON.parse(String(e.data)))
      ws.onerror = reject
    })
    const frame = await first
    ws.close()
    expect(frame.snapshot?.chats).toMatchObject([{ title: "Kiko", pinned: true, kiko: true }])
  })
})

describe("without ACCESS_CODE", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start({})
  })

  test("the sign-in route answers 404, even with a code", async () => {
    const res = await signIn(origin, { code: CODE })
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})
