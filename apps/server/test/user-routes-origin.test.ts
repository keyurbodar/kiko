import { expect, test } from "bun:test"
import type { Env } from "../src/index"
import { remindersRoute } from "../src/user/reminders-route"
import { soulRoute } from "../src/user/soul-route"

// The check runs before the session lookup, so an env with no bindings is enough to reach it.
const env = {} as unknown as Env
const foreign = (url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { origin: "https://evil.example", "content-type": "application/json" } })

test("reminders and souls refuse a request from another origin before reading the session", async () => {
  expect((await remindersRoute(foreign("https://kiko.example/api/reminders"), env))?.status).toBe(403)
  expect((await remindersRoute(foreign("https://kiko.example/api/reminders/0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a/cancel", { method: "POST", body: "{}" }), env))?.status).toBe(403)
  expect((await soulRoute(foreign("https://kiko.example/api/souls/ada", { method: "PUT", body: "{}" }), env))?.status).toBe(403)
})
