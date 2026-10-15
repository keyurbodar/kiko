import { expect, test } from "bun:test"
import worker, { type Env } from "./handler"

const env = { TRUSTED_ORIGINS: "https://app.kiko.codes, https://b.example", CF_OAUTH_CLIENT_ID: "cid" } as Env
const call = (path: string, origin?: string, method = "GET") =>
  worker.fetch(new Request(`https://api.test${path}`, { method, headers: origin ? { Origin: origin } : {} }), env)

test("a trusted origin gets CORS headers", async () => {
  const res = await call("/oauth/config", "https://b.example")
  expect(res.status).toBe(200)
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://b.example")
  expect(await res.json()).toMatchObject({ clientId: "cid", authorizeUrl: "https://dash.cloudflare.com/oauth2/auth" })
})

test("an untrusted origin is rejected without CORS headers", async () => {
  const res = await call("/oauth/config", "https://evil.example")
  expect(res.status).toBe(403)
  expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  expect((await call("/install", "https://evil.example", "POST")).status).toBe(403)
  expect((await call("/install", "https://evil.example", "OPTIONS")).status).toBe(403)
})

test("the token link lists permissions", async () => {
  const body = (await (await call("/token-link")).json()) as { url: string; permissions: string[] }
  expect(body.url).toBe("https://dash.cloudflare.com/profile/api-tokens")
  expect(body.permissions.length).toBe(3)
})
