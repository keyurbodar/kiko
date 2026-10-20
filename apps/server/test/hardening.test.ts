import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { HELLO_TIMEOUT_CODE, HELLO_TIMEOUT_MS } from "@kiko/durable/hello-deadline"
import { bundleWorker } from "./bundle"

let owner: Miniflare
beforeAll(async () => {
  owner = new Miniflare({
    modules: true,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
    durableObjects: { OWNER: { className: "OwnerDO", useSQLite: true } },
  })
}, 60_000)
afterAll(async () => { await owner?.dispose() })

test("a session check that hangs answers 504 at the deadline", async () => {
  const { route, UPGRADE_TIMEOUT_MS } = await import("../src/router")
  const request = new Request("http://kiko.test/api/ws", { headers: { upgrade: "websocket" } })
  const start = Date.now()
  const response = await route(request, {} as never, () => new Promise<null>(() => {}))
  expect(response?.status).toBe(504)
  expect(Date.now() - start).toBeGreaterThanOrEqual(UPGRADE_TIMEOUT_MS - 200)
}, 15_000)

test("an owner socket without hello closes while one that greets remains open", async () => {
  const origin = (await owner.ready).origin.replace(/^http/, "ws")
  const silent = new WebSocket(`${origin}/ws/silent`)
  const polite = new WebSocket(`${origin}/ws/polite`)
  const started = Date.now()
  const closed = new Promise<CloseEvent>((resolve) => { silent.onclose = resolve })
  await Promise.all([silent, polite].map((socket) => new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })))
  polite.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
  const ended = await closed
  expect(ended.code).toBe(HELLO_TIMEOUT_CODE)
  expect(ended.reason).toBe("no hello within 5 seconds")
  expect(Date.now() - started).toBeGreaterThanOrEqual(HELLO_TIMEOUT_MS - 200)
  expect(Date.now() - started).toBeLessThan(HELLO_TIMEOUT_MS + 3_000)
  expect(polite.readyState).toBe(WebSocket.OPEN)
  polite.close()
}, 15_000)
