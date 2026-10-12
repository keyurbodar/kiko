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
    d1Databases: ["AUTH_DB"],
    durableObjects: {
      USER: { className: "UserDO", useSQLite: true },
      ROOM: { className: "RoomDO", useSQLite: true },
      AGENT: { className: "AgentDO", useSQLite: true },
    },
    serviceBindings: { ASSETS: () => new Response("app shell") },
    bindings: { BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long", ...bindings },
  })
  workers.push(mf)
  const db = await mf.getD1Database("AUTH_DB")
  for (const file of (await readdir(join(serverDir, "migrations"))).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = await readFile(join(serverDir, "migrations", file), "utf8")
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(statement).run()
    }
  }
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

describe("with ACCESS_CODE set", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start({ ACCESS_CODE: CODE })
  })

  test("reports the access code sign-in", async () => {
    expect(await (await fetch(`${origin}/api/providers`)).json()).toEqual({
      google: false,
      github: false,
      dev: false,
      code: true,
    })
  })

  test("the right code signs in, sets a session cookie, and names the user from the form", async () => {
    const res = await signIn(origin, { code: CODE, name: "owner" })
    expect(res.status).toBe(200)
    const token = res.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))
    expect(token).toBeDefined()
    const me = await fetch(`${origin}/api/me`, { headers: { cookie: token!.split(";")[0]! } })
    expect(me.status).toBe(200)
    const { user } = (await me.json()) as { user: { name: string; email: string } }
    expect(user).toMatchObject({ name: "owner", email: "owner@code.yuki" })
  })

  test("the same name signs in as the same user, and another name as another user", async () => {
    const ids = async (name: string) => {
      const res = await signIn(origin, { code: CODE, name })
      return ((await res.json()) as { user: { id: string } }).user.id
    }
    const first = await ids("friend")
    expect(await ids("friend")).toBe(first)
    expect(await ids("guest")).not.toBe(first)
  })

  test("a wrong code answers 401 with the fixed message and sets no cookie", async () => {
    const res = await signIn(origin, { code: "not-the-code", name: "mallory" })
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(((await res.json()) as { message: string }).message).toBe("That access code is not right")
  })

  test("a missing code answers 401, not a server error", async () => {
    expect((await signIn(origin, { name: "mallory" })).status).toBe(401)
  })

  test("a bad name answers 400", async () => {
    expect((await signIn(origin, { code: CODE, name: "Not A Name" })).status).toBe(400)
  })
})

describe("without ACCESS_CODE", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start({})
  })

  test("reports no access code sign-in", async () => {
    expect(await (await fetch(`${origin}/api/providers`)).json()).toEqual({
      google: false,
      github: false,
      dev: false,
      code: false,
    })
  })

  test("the sign-in route answers 404, even with a code", async () => {
    const res = await signIn(origin, { code: CODE, name: "owner" })
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})
