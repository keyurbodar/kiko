import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"


const PROVIDER = "acme-test"

type Answer = { status: number; text: string; body: unknown }

const suite: Suite = {
  name: "credentials",
  async run(v) {
    const base = v.url
    const key = `sk-verify-${crypto.randomUUID().replaceAll("-", "")}`

    async function call(auth: string | null, method: string, path: string, body?: unknown, origin?: string): Promise<Answer> {
      const headers: Record<string, string> = {}
      if (auth) headers.authorization = auth
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
    await call(alice.auth, "DELETE", `api/credentials/${PROVIDER}`)

    const anon = await call(null, "GET", "api/credentials")
    expectEqual(anon.status, 401, "status without a session")
    const forged = await call(alice.auth, "PUT", `api/credentials/${PROVIDER}`, { apiKey: key }, "https://evil.example")
    expectEqual(forged.status, 403, "status from a foreign origin")

    const saved = await call(alice.auth, "PUT", `api/credentials/${PROVIDER}`, { apiKey: key })
    expectEqual(saved.status, 200, "status of the save")
    const row = { provider: PROVIDER, kind: "api_key", last4: key.slice(-4), chat: false, judge: false }
    expectEqual(saved.body, { provider: row }, "save answer")

    expectEqual((await call(alice.auth, "GET", "api/credentials")).body, { providers: [row] }, "alice's providers")
    expectEqual((await call(bob.auth, "GET", "api/credentials")).body, { providers: [] }, "bob's providers")

    const refused = await call(alice.auth, "PUT", "api/credentials/opencode-go", { apiKey: `sk-not-a-real-key-${key.slice(-8)}` })
    expectEqual([refused.status, refused.body], [400, { error: "The provider refused that key" }], "a key the provider refuses")
    expectEqual((await call(alice.auth, "GET", "api/credentials")).body, { providers: [{ provider: PROVIDER, kind: "api_key", last4: key.slice(-4), chat: false, judge: false }] }, "providers after a refused save")

    const bad = await call(alice.auth, "PUT", "api/credentials/Not%20A%20Provider", { apiKey: key })
    expectEqual(bad.status, 400, "status for a bad provider id")

    const removed = await call(alice.auth, "DELETE", `api/credentials/${PROVIDER}`)
    expectEqual(removed.body, { removed: true }, "disconnect answer")
    expectEqual((await call(alice.auth, "GET", "api/credentials")).body, { providers: [] }, "providers after disconnect")
  },
}

export default suite
