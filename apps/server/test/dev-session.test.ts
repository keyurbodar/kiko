import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Miniflare } from "miniflare"

// Builds the Worker twice with the real `wrangler deploy --dry-run`, once as production
// and once as development, then runs each bundle in workerd with a migrated D1.
// The production bundle must not contain the dev sign-in route at all.

const serverDir = new URL("..", import.meta.url).pathname
const cliEntry = new URL("../../cli/src/index.ts", import.meta.url).pathname
const MARKER = "kiko-dev-session"

let tmp: string
const workers: Miniflare[] = []

async function build(nodeEnv: "production" | "development"): Promise<string> {
  // Returns the path of the bundled Worker.
  const outdir = join(tmp, nodeEnv)
  const env = { ...process.env, NODE_ENV: nodeEnv }
  const p = Bun.spawn(
    ["bunx", "wrangler", "deploy", "--dry-run", "--outdir", outdir, "--assets", join(tmp, "assets")],
    { cwd: serverDir, env, stdout: "pipe", stderr: "pipe" },
  )
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  if ((await p.exited) !== 0) throw new Error(`wrangler build failed\n${out}\n${err}`)
  return join(outdir, "index.js")
}

async function start(path: string): Promise<string> {
  // The bundle imports modules by computed names, so list it as the only module.
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path }],
    modulesRoot: dirname(path),
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
    bindings: { BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long" },
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

async function cli(args: string[]) {
  const p = Bun.spawn(["bun", cliEntry, ...args], {
    env: { ...process.env, KIKO_SESSION_FILE: join(tmp, "cli-session.json") },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, out: out.trim(), err: err.trim() }
}

let prodPath: string
let devPath: string
let prodScript: string
let devScript: string

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "kiko-auth-"))
  await Bun.write(join(tmp, "assets", "index.html"), "app shell")
  ;[prodPath, devPath] = await Promise.all([build("production"), build("development")])
  ;[prodScript, devScript] = await Promise.all([readFile(prodPath, "utf8"), readFile(devPath, "utf8")])
}, 120_000)

afterAll(async () => {
  await Promise.all(workers.map((mf) => mf.dispose()))
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe("production build", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start(prodPath)
  })

  test("does not contain the dev sign-in code", () => {
    expect(prodScript).not.toContain(MARKER)
    expect(prodScript).not.toContain("dev.kiko.test")
  })

  test("answers the dev sign-in route with 404", async () => {
    const res = await fetch(`${origin}/api/auth/dev/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "mallory" }),
    })
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  test("refuses /api/me without a cookie", async () => {
    expect((await fetch(`${origin}/api/me`)).status).toBe(401)
  })

  test("reports no providers and no dev sign-in", async () => {
    expect(await (await fetch(`${origin}/api/providers`)).json()).toEqual({ google: false, github: false, dev: false })
  })

  test("kiko login --dev fails", async () => {
    const r = await cli(["login", "--dev", "--url", origin])
    expect(r.code).toBe(1)
    expect(r.err).toContain("no dev sign-in route")
  })
})

describe("development build", () => {
  let origin: string
  beforeAll(async () => {
    origin = await start(devPath)
  })

  test("contains the dev sign-in code", () => {
    expect(devScript).toContain(MARKER)
  })

  test("refuses /api/me without a cookie", async () => {
    expect((await fetch(`${origin}/api/me`)).status).toBe(401)
  })

  test("reports dev sign-in on", async () => {
    expect(await (await fetch(`${origin}/api/providers`)).json()).toEqual({ google: false, github: false, dev: true })
  })

  test("kiko login --dev stores a session and kiko whoami prints the same user id", async () => {
    const before = await cli(["whoami", "--url", origin])
    expect(before.code).toBe(1)

    const login = await cli(["login", "--dev", "--name", "alice", "--url", origin])
    expect(login.code).toBe(0)
    expect(login.out).toMatch(/^\S+$/)

    const me = await cli(["whoami", "--url", origin])
    expect(me.code).toBe(0)
    expect(me.out).toBe(login.out)
  })

  test("the same name signs in as the same user, and another name as another user", async () => {
    const a1 = await cli(["login", "--dev", "--name", "bob", "--url", origin])
    const a2 = await cli(["login", "--dev", "--name", "bob", "--url", origin])
    const c = await cli(["login", "--dev", "--name", "carol", "--url", origin])
    expect(a1.out).toBe(a2.out)
    expect(c.out).not.toBe(a1.out)
  })

  test("a session token alone, without the cookie cache, still signs in", async () => {
    const res = await fetch(`${origin}/api/auth/dev/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dave" }),
    })
    const token = res.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))
    expect(token).toBeDefined()
    const me = await fetch(`${origin}/api/me`, { headers: { cookie: token!.split(";")[0]! } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { user: { name: string } }).user.name).toBe("dave")
  })

  test("a forged cookie is refused", async () => {
    const me = await fetch(`${origin}/api/me`, { headers: { cookie: "better-auth.session_token=forged.value" } })
    expect(me.status).toBe(401)
  })

  test("the dev route refuses a host that is not local", async () => {
    const res = await fetch(`${origin}/api/auth/dev/session`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "kiko.example.com" },
      body: JSON.stringify({ name: "erin" }),
    })
    expect(res.status).toBe(404)
  })

  test("the dev route rejects a bad name", async () => {
    const res = await fetch(`${origin}/api/auth/dev/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Not A Name" }),
    })
    expect(res.status).toBe(400)
  })
})
