import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Miniflare } from "miniflare"

// The production bundle, with and without the ACCESS_CODE secret. The sign-in method is not dev-only,
// so both tests run against a deploy build.
const serverDir = new URL("..", import.meta.url).pathname
const CODE = "correct-horse-battery-staple"

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
      USER: { className: "UserDO", useSQLite: true },
      ROOM: { className: "RoomDO", useSQLite: true },
      AGENT: { className: "AgentDO", useSQLite: true },
    },
    serviceBindings: { ASSETS: () => new Response("app shell") },
    bindings: { SESSION_SECRET: "test-secret-that-is-at-least-32-characters-long", ...bindings },
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

const sessionCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("kiko_session="))

describe("with ACCESS_CODE set", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start({ ACCESS_CODE: CODE })
  })

  test("the right code sets a one year, HttpOnly, Lax cookie that /api/me accepts as the owner", async () => {
    const res = await signIn(origin, { code: CODE })
    expect(res.status).toBe(200)
    const cookie = sessionCookie(res)
    expect(cookie).toBeDefined()
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain(`Max-Age=${365 * 24 * 60 * 60}`)
    const me = await fetch(`${origin}/api/me`, { headers: { cookie: cookie!.split(";")[0]! } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe("owner")
  })

  test("a wrong code answers 401 with the fixed message and sets no cookie", async () => {
    const res = await signIn(origin, { code: "not-the-code" })
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(((await res.json()) as { message: string }).message).toBe("That access code is not right")
  })

  test("a missing code answers 401, not a server error", async () => {
    expect((await signIn(origin, {})).status).toBe(401)
  })

  test("a cookie with a tampered owner id or mac is refused", async () => {
    const cookie = sessionCookie(await signIn(origin, { code: CODE }))!.split(";")[0]!
    const [, value] = cookie.split("=")
    const [id, mac] = value!.split(".")
    const refused = async (forged: string) => (await fetch(`${origin}/api/me`, { headers: { cookie: `kiko_session=${forged}` } })).status
    expect(await refused(`other.${mac}`)).toBe(401)
    expect(await refused(`${id}.${mac!.replace(/^./, mac![0] === "0" ? "1" : "0")}`)).toBe(401)
    expect(await refused("garbage")).toBe(401)
  })

  test("sign out clears the cookie", async () => {
    const res = await fetch(`${origin}/api/auth/sign-out`, { method: "POST" })
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().find((c) => c.startsWith("kiko_session=;"))).toContain("Max-Age=0")
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
