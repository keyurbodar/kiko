import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Miniflare } from "miniflare"

const serverDir = new URL("..", import.meta.url).pathname
const cliEntry = new URL("../../cli/src/index.ts", import.meta.url).pathname
const MARKER = "name must match [a-z0-9-]"

let tmp: string
const workers: Miniflare[] = []

async function build(nodeEnv: "production" | "development"): Promise<string> {
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
  const wasm = (await readdir(dirname(path))).filter((f) => f.endsWith(".wasm")).map((f) => ({ type: "CompiledWasm" as const, path: join(dirname(path), f) }))
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path }, ...wasm],
    modulesRoot: dirname(path),
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
    bindings: { SESSION_SECRET: "test-secret-that-is-at-least-32-characters-long" },
  })
  workers.push(mf)
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

  test("refuses /api/me without a token", async () => {
    expect((await fetch(`${origin}/api/me`)).status).toBe(401)
  })

  test("kiko login --dev fails", async () => {
    const r = await cli(["login", "--dev", "--url", origin])
    expect(r.code).toBe(1)
    expect(r.err).toContain("no such sign-in route")
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

  test("refuses /api/me without a token", async () => {
    expect((await fetch(`${origin}/api/me`)).status).toBe(401)
  })

  test("kiko login --dev stores a session and kiko whoami prints the same user id", async () => {
    const before = await cli(["whoami", "--url", origin])
    expect(before.code).toBe(1)

    const login = await cli(["login", "--dev", "--name", "alice", "--url", origin])
    expect(login.code).toBe(0)
    expect(login.out).toBe("alice")

    const me = await cli(["whoami", "--url", origin])
    expect(me.code).toBe(0)
    expect(me.out).toBe(login.out)
  })

  test("the same name signs in as the same owner, and another name as another owner", async () => {
    const a1 = await cli(["login", "--dev", "--name", "bob", "--url", origin])
    const a2 = await cli(["login", "--dev", "--name", "bob", "--url", origin])
    const c = await cli(["login", "--dev", "--name", "carol", "--url", origin])
    expect(a1.out).toBe(a2.out)
    expect(c.out).not.toBe(a1.out)
  })

  test("a forged token is refused", async () => {
    const me = await fetch(`${origin}/api/me`, { headers: { authorization: `Bearer dave.session.${Math.floor(Date.now() / 1000) + 3600}.${"0".repeat(64)}` } })
    expect(me.status).toBe(401)
  })

  test("the dev route returns a token that /api/me accepts, and a GET hands a browser the same token in the hash", async () => {
    const res = await fetch(`${origin}/api/auth/dev/session?name=frank`, { redirect: "manual" })
    expect(res.status).toBe(302)
    const token = res.headers.get("location")?.replace("/#token=", "") ?? ""
    const me = await fetch(`${origin}/api/me`, { headers: { authorization: `Bearer ${token}` } })
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe("frank")
  })

  test("the dev route refuses a host that is not local", async () => {
    const res = await fetch(`${origin}/api/auth/dev/session`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "kiko.example.com" },
      body: JSON.stringify({ name: "erin" }),
    })
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie()).toEqual([])
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
