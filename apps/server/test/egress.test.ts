import { expect, test } from "bun:test"
import { userModels } from "../src/agent/factory"

// With an egress fetch, a model request goes out through it, so on the
// Free plan each request is its own invocation with its own 50 subrequests.

test("a model request goes out through the egress fetch", async () => {
  const seen: string[] = []
  const egress = (async (input: RequestInfo | URL) => {
    seen.push(String(input instanceof Request ? input.url : input))
    return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  const { models } = userModels(async () => ({ apiKey: "test-key" }) as never, "s1", egress)
  const provider = models.getProvider("opencode-go")!
  const model = provider.getModels()[0]!
  const stream = provider.stream(model, { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] } as never, { apiKey: "test-key" } as never)
  for await (const _ of stream) {
  }
  expect(seen.length).toBeGreaterThan(0)
  expect(seen[0]).toContain("opencode")
})
