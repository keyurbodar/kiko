import { afterAll, expect, test } from "bun:test"

const server = Bun.serve({
  port: 0,
  fetch(req, srv) {
    const u = new URL(req.url)
    if (u.pathname === "/api/health") return Response.json({ ok: true })
    if (u.pathname === "/bad/api/health") return new Response("no", { status: 500 })
    if (u.pathname === "/echo" && srv.upgrade(req)) return
    return new Response("nf", { status: 404 })
  },
  websocket: {
    message: (s, m) => {
      s.send(JSON.stringify({ echo: String(m) }))
    },
  },
})
afterAll(() => server.stop(true))

async function run(args: string[], stdin = "", env?: Record<string, string>) {
  const p = Bun.spawn(["bun", `${import.meta.dir}/index.ts`, ...args], {
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : undefined,
  })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, out, err }
}

test("health ok", async () => {
  const r = await run(["health", "--url", `http://localhost:${server.port}`])
  expect(r.code).toBe(0)
  expect(r.out.trim()).toBe("ok")
})

test("health exits 1 with one line when down", async () => {
  const r = await run(["health", "--url", "http://localhost:1"])
  expect(r.code).toBe(1)
  const lines = r.err.trim().split("\n")
  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe("yuki: target http://localhost:1")
  expect(lines[1]).toMatch(/^yuki: health failed: cannot reach http:\/\/localhost:1 /)
})

test("YUKI_URL sets the default target and prints it first", async () => {
  const r = await run(["health"], "", { YUKI_URL: `http://localhost:${server.port}` })
  expect(r.code).toBe(0)
  expect(r.err.split("\n")[0]).toBe(`yuki: target http://localhost:${server.port}`)
  expect(r.out.trim()).toBe("ok")
})

test("--url overrides YUKI_URL", async () => {
  const r = await run(["health", "--url", `http://localhost:${server.port}`], "", { YUKI_URL: "http://localhost:1" })
  expect(r.code).toBe(0)
  expect(r.err.split("\n")[0]).toBe(`yuki: target http://localhost:${server.port}`)
})

test("health exits 1 on bad status", async () => {
  const r = await run(["health", "--url", `http://localhost:${server.port}/bad/`])
  expect(r.code).toBe(1)
})

test("ws sends stdin and prints frames", async () => {
  const r = await run(["ws", "/echo", "--url", `http://localhost:${server.port}`, "--idle", "200"], "a\nb\n")
  expect(r.code).toBe(0)
  expect(r.out.trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ echo: "a" }, { echo: "b" }])
})

test("unknown command fails", async () => {
  expect((await run(["nope"])).code).toBe(1)
})
