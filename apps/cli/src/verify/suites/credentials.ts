import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P4-01. Save a provider key over HTTP, read back only its last four characters,
// disconnect, and see the row gone. The key is made up, so no model is called. No
// answer may contain it, and a second user never sees the first user's row.

const PROVIDER = "opencode-go"

type Answer = { status: number; text: string; body: any }

const suite: Suite = {
  name: "credentials",
  async run(v) {
    const base = v.url.endsWith("/") ? v.url : `${v.url}/`
    const key = `sk-verify-${crypto.randomUUID().replaceAll("-", "")}`

    async function call(cookie: string | null, method: string, path: string, body?: unknown, origin?: string): Promise<Answer> {
      const headers: Record<string, string> = {}
      if (cookie) headers.cookie = cookie
      if (body !== undefined) headers["content-type"] = "application/json"
      if (origin) headers.origin = origin
      const res = await fetch(new URL(path, base), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      const text = await res.text()
      if (text.includes(key)) throw new VerifyError(`${method} ${path} returned the full key`)
      return { status: res.status, text, body: text ? JSON.parse(text) : null }
    }

    const alice = await v.as("credentials-alice")
    const bob = await v.as("credentials-bob")
    // A rerun starts clean.
    await call(alice.cookie, "DELETE", `api/credentials/${PROVIDER}`)

    const anon = await call(null, "GET", "api/credentials")
    expectEqual(anon.status, 401, "status without a session")
    const forged = await call(alice.cookie, "PUT", `api/credentials/${PROVIDER}`, { apiKey: key }, "https://evil.example")
    expectEqual(forged.status, 403, "status from a foreign origin")

    const saved = await call(alice.cookie, "PUT", `api/credentials/${PROVIDER}`, { apiKey: key })
    expectEqual(saved.status, 200, "status of the save")
    const row = { provider: PROVIDER, kind: "api_key", last4: key.slice(-4) }
    expectEqual(saved.body, { provider: row }, "save answer")

    expectEqual((await call(alice.cookie, "GET", "api/credentials")).body, { providers: [row] }, "alice's providers")
    expectEqual((await call(bob.cookie, "GET", "api/credentials")).body, { providers: [] }, "bob's providers")

    const bad = await call(alice.cookie, "PUT", "api/credentials/Not%20A%20Provider", { apiKey: key })
    expectEqual(bad.status, 400, "status for a bad provider id")

    const removed = await call(alice.cookie, "DELETE", `api/credentials/${PROVIDER}`)
    expectEqual(removed.body, { removed: true }, "disconnect answer")
    expectEqual((await call(alice.cookie, "GET", "api/credentials")).body, { providers: [] }, "providers after disconnect")
  },
}

export default suite
