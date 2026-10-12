import { expect, test } from "bun:test"
import { catalogReadOnly, checkKey, composioRpc, createSession, deleteSession } from "../src/integrations/composio/client"

type Seen = { url: string; headers: Record<string, string> }

function fakeFetch() {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), headers: init.headers as Record<string, string> })
    const id = JSON.parse(String(init.body ?? "{}")).id
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    })
  }) as unknown as typeof fetch
  return { seen, fetchImpl }
}

test("a Composio Connect key talks to its own MCP url with the consumer header, and needs no session", async () => {
  const { seen, fetchImpl } = fakeFetch()
  const session = await createSession("ck_test", "u1", fetchImpl)
  expect(session.url).toBe("https://connect.composio.dev/mcp")
  await deleteSession("ck_test", session.id, fetchImpl)
  expect(await catalogReadOnly("ck_test", "GMAIL_FETCH_EMAILS", fetchImpl)).toBe(false)
  expect(seen).toHaveLength(0)
  await composioRpc({ key: "ck_test", url: session.url }, "tools/list", {}, fetchImpl)
  await checkKey("ck_test", fetchImpl)
  expect(seen.map((s) => s.url)).toEqual(["https://connect.composio.dev/mcp", "https://connect.composio.dev/mcp"])
  for (const s of seen) {
    expect(s.headers["x-consumer-api-key"]).toBe("ck_test")
    expect(s.headers["x-api-key"]).toBeUndefined()
  }
})

test("a Platform key keeps the x-api-key header", async () => {
  const { seen, fetchImpl } = fakeFetch()
  await composioRpc({ key: "ak_test", url: "https://backend.composio.dev/tool_router/s1/mcp" }, "tools/list", {}, fetchImpl)
  expect(seen[0]?.headers["x-api-key"]).toBe("ak_test")
  expect(seen[0]?.headers["x-consumer-api-key"]).toBeUndefined()
})
