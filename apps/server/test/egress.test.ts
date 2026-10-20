import { expect, test } from "bun:test"
import { userModels } from "../src/agent/factory"

test("a model request goes out through the egress fetch", async () => {
  const seen: string[] = []
  let directCalls = 0
  const egress = (async (input: RequestInfo | URL) => {
    seen.push(String(input instanceof Request ? input.url : input))
    return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  const { models } = userModels(async () => ({ apiKey: "test-key" }) as never, "s1", egress, () => directCalls++)
  const provider = models.getProvider("opencode-go")!
  const model = provider.getModels()[0]!
  const stream = provider.stream(model, { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] } as never, { apiKey: "test-key" } as never)
  for await (const _ of stream) {
  }
  expect(seen.length).toBeGreaterThan(0)
  expect(seen[0]).toContain("opencode")
  expect(directCalls).toBe(0)
})

test("a model adapter without custom fetch counts its direct request", async () => {
  let directCalls = 0
  let requests = 0
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    requests++
    return new Response(JSON.stringify({ error: { message: "nope", code: 401, status: "UNAUTHENTICATED" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  try {
    const egress = (async () => { throw new Error("Google must not receive custom fetch") }) as typeof fetch
    const { models } = userModels(async () => ({ apiKey: "test-key" }), "s1", egress, () => directCalls++)
    const provider = models.getProvider("google")!
    const model = provider.getModels()[0]!
    const stream = provider.stream(model, { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] } as never, { apiKey: "test-key" } as never)
    for await (const _ of stream) {
    }
    expect(requests).toBe(1)
    expect(directCalls).toBe(1)
  } finally {
    globalThis.fetch = original
  }
})
