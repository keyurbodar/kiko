import { describe, expect, test } from "bun:test"
import { effectOf } from "@yuki/agent/effects"
import { callTool, ComposioError, listTools, parseRpcResponse, REJECTED } from "../src/integrations/composio/client"
import { composioExtension, HIDDEN } from "../src/integrations/composio/tools"

const SSE = "text/event-stream"
const reply = (id: number, result: unknown) => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`

describe("composio event stream", () => {
  test("the answer is the event whose id matches, past comment lines and other events", () => {
    const body = `: connected\n\n: connected\n\n${reply(2, "other")}${reply(3, { tools: [] })}`
    expect(parseRpcResponse(body, `${SSE}; charset=utf-8`, 3)).toEqual({ tools: [] })
  })

  test("a data field split over lines is joined, and CRLF works", () => {
    const body = 'event: message\r\ndata: {"jsonrpc":"2.0","id":7,\r\ndata: "result":{"ok":1}}\r\n\r\n'
    expect(parseRpcResponse(body, SSE, 7)).toEqual({ ok: 1 })
  })

  test("a plain JSON body works too", () => {
    expect(parseRpcResponse(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 5 }), "application/json", 1)).toBe(5)
  })

  test("a JSON-RPC error and a missing answer are errors", () => {
    expect(() => parseRpcResponse(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 4, error: { code: -32602, message: "bad args" } })}\n\n`, SSE, 4)).toThrow("bad args")
    expect(() => parseRpcResponse(reply(1, {}), SSE, 9)).toThrow(ComposioError)
  })
})

describe("composio client", () => {
  const fake = (status: number, body: string) => (async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { id: number }
    return new Response(body.replaceAll("__ID__", String(sent.id)), { status, headers: { "content-type": SSE } })
  }) as unknown as typeof fetch

  test("a rejected key is a typed 401 that never echoes the key", async () => {
    const err = await listTools("ck_secret", fake(401, "unauthorized")).catch((e) => e)
    expect(err).toBeInstanceOf(ComposioError)
    expect(err.status).toBe(401)
    expect(err.message).toBe(REJECTED)
    expect(err.message).not.toContain("ck_secret")
  })

  test("readOnlyHint becomes readOnly, and a call keeps text and image blocks", async () => {
    const listed = `data: {"jsonrpc":"2.0","id":__ID__,"result":{"tools":[{"name":"COMPOSIO_SEARCH_TOOLS","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":true}},{"name":"COMPOSIO_MULTI_EXECUTE_TOOL","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":false}}]}}\n\n`
    const tools = await listTools("k", fake(200, listed))
    expect(tools.map((t) => [t.name, t.readOnly ?? false])).toEqual([["COMPOSIO_SEARCH_TOOLS", true], ["COMPOSIO_MULTI_EXECUTE_TOOL", false]])
    const called = `data: {"jsonrpc":"2.0","id":__ID__,"result":{"isError":true,"content":[{"type":"text","text":"hi"},{"type":"image","data":"AA==","mimeType":"image/png"},{"type":"resource","resource":{"uri":"x"}}]}}\n\n`
    const out = await callTool("k", "COMPOSIO_SEARCH_TOOLS", {}, fake(200, called))
    expect(out.isError).toBe(true)
    expect(out.content).toEqual([{ type: "text", text: "hi" }, { type: "image", data: "AA==", mimeType: "image/png" }, { type: "text", text: '{"type":"resource","resource":{"uri":"x"}}' }])
  })
})

describe("composio tools", () => {
  const schema = { type: "object", properties: {} }
  const listed = [
    { name: "COMPOSIO_SEARCH_TOOLS", inputSchema: schema, readOnly: true },
    { name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema: schema },
    ...Object.keys(HIDDEN).map((name) => ({ name, inputSchema: schema })),
  ]

  test("visible tools are composio_<slug>, read-only ones read and safe to replay, the rest external", () => {
    const tools = composioExtension(listed, async () => ({ content: [] })).tools ?? []
    expect(tools.map((t) => t.name)).toEqual(["composio_search_tools", "composio_multi_execute_tool"])
    expect(effectOf(tools[0]!)).toEqual({ effect: "read", outside: "composio" })
    expect(effectOf(tools[1]!)).toEqual({ effect: "external", outside: "composio" })
    expect((tools as unknown as { replay: string }[]).map((t) => t.replay)).toEqual(["safe", "unsafe"])
  })

  test("a call goes to composio by its own slug, and a failure comes back as a tool error", async () => {
    const calls: string[] = []
    const [search] = composioExtension(listed, async (name) => {
      calls.push(name)
      throw new Error("offline")
    }).tools ?? []
    const out = await (search as unknown as { execute: (a: unknown, api: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }).execute({ queries: [] }, { conversationId: "c", callId: "1" })
    expect(calls).toEqual(["COMPOSIO_SEARCH_TOOLS"])
    expect(out.isError).toBe(true)
    expect(out.content[0]!.text).toContain("offline")
  })
})
