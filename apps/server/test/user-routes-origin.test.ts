import { expect, test } from "bun:test"
import type { Env } from "../src/index"
import { routinesRoute } from "../src/user/routines-route"
import { soulRoute } from "../src/user/soul-route"

// The check runs before the session lookup, so an env with no bindings is enough to reach it.
const env = {} as unknown as Env
const foreign = (url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { origin: "https://evil.example", "content-type": "application/json" } })

test("routines and souls refuse a request from another origin before reading the session", async () => {
  expect((await routinesRoute(foreign("https://kiko.example/api/routines"), env))?.status).toBe(403)
  expect((await routinesRoute(foreign("https://kiko.example/api/routines/0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a/cancel", { method: "POST", body: "{}" }), env))?.status).toBe(403)
  expect((await soulRoute(foreign("https://kiko.example/api/souls/ada", { method: "PUT", body: "{}" }), env))?.status).toBe(403)
})
