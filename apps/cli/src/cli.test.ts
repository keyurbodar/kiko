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

async function run(args: string[], stdin = "") {
  const p = Bun.spawn(["bun", `${import.meta.dir}/index.ts`, ...args], {
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
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
  expect(r.err.trim().split("\n")).toHaveLength(1)
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
