import { describe, expect, test } from "bun:test"
import { effectOf } from "@yuki/agent/effects"
import { callTool, ComposioError, DEVELOPER_REJECTED, learnedSignature, listTools, parseRpcResponse, REJECTED } from "../src/integrations/composio/client"
import { ComposioConnection } from "../src/integrations/composio/connect"
import { LEARNED_MAX, type LearnedTool, remember } from "../src/integrations/composio/learn"
import type { ComposioStore } from "../src/integrations/composio/store"
import { composioExtension, learnedNote } from "../src/integrations/composio/tools"

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
  ]

  test("tools are composio_<slug>, read-only ones read and safe to replay, the rest external", () => {
    const tools = composioExtension(listed, async () => ({ content: [] })).tools ?? []
    expect(tools.map((t) => t.name)).toEqual(["composio_search_tools", "composio_multi_execute_tool"])
    expect(effectOf(tools[0]!)).toBe("read")
    expect(effectOf(tools[1]!)).toBe("external")
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

describe("composio required booleans", () => {
  test("the shown schema no longer requires a boolean, and an omitted one is sent as false", async () => {
    const inputSchema = { type: "object", properties: { thought: { type: "string" }, sync_response_to_workbench: { type: "boolean" } }, required: ["thought", "sync_response_to_workbench"] }
    const sent: unknown[] = []
    const [tool] = composioExtension([{ name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema }], async (_n, args) => {
      sent.push(args)
      return { content: [] }
    }).tools ?? []
    expect((tool as unknown as { parameters: { required: string[] } }).parameters.required).toEqual(["thought"])
    expect(inputSchema.required).toEqual(["thought", "sync_response_to_workbench"])
    await (tool as unknown as { execute: (a: unknown, api: unknown) => Promise<unknown> }).execute({ thought: "x" }, { conversationId: "c", callId: "1" })
    expect(sent).toEqual([{ thought: "x", sync_response_to_workbench: false }])
  })

  test("a learned tool keeps its required boolean and is not filled", async () => {
    const inputSchema = { type: "object", properties: { to: { type: "string" }, send: { type: "boolean" } }, required: ["to", "send"] }
    const sent: unknown[] = []
    const [tool] = composioExtension([{ name: "GMAIL_X", inputSchema, direct: { slug: "GMAIL_X", toolkit: "gmail" } }], async (_n, args) => {
      sent.push(args)
      return { content: [] }
    }).tools ?? []
    expect((tool as unknown as { parameters: { required: string[] } }).parameters.required).toEqual(["to", "send"])
    await (tool as unknown as { execute: (a: unknown, api: unknown) => Promise<unknown> }).execute({ to: "a" }, { conversationId: "c", callId: "1" })
    expect((sent[0] as { tools: { arguments: unknown }[] }).tools[0]!.arguments).toEqual({ to: "a" })
  })
})

describe("composio learned tools", () => {
  const text = (v: unknown) => `data: ${JSON.stringify({ jsonrpc: "2.0", id: "__ID__", result: { content: [{ type: "text", text: JSON.stringify(v) }] } })}\n\n`
  const webSchema = { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  const searchBody = { successful: true, data: { tool_schemas: { COMPOSIO_SEARCH_WEB: { toolkit: "composio_search", tool_slug: "COMPOSIO_SEARCH_WEB", description: "Search the web.", input_schema: webSchema }, GMAIL_GET_ATTACHMENT: { toolkit: "gmail", tool_slug: "GMAIL_GET_ATTACHMENT", schemaRef: {} } } } }
  const ran = (slug: string, ok: boolean) => ({ successful: true, data: { results: [{ response: { successful: ok, data: { answer: "1.4.2" }, error: ok ? null : "no connection" }, tool_slug: slug, index: 0 }] } })

  /**
   * A connection over an in-memory store, answering each call with the next queued body. The
   * catalog tags every tool `catalog`, and a developer key is stored when `catalog` is given.
   */
  function setup(catalog?: string[]) {
    const state = { learned: [] as LearnedTool[], sent: [] as { name: string; arguments: unknown }[], replies: [] as unknown[], developer: catalog && "ak", developerStatus: 200, tags: catalog }
    const store = {
      generation: 0,
      connected: () => true,
      key: async () => "k",
      developerKey: async () => state.developer,
      hasDeveloperKey: () => state.developer !== undefined,
      putDeveloperKey: async (key: string | null) => void (state.developer = key ?? undefined),
      count: () => 1,
      listing: () => ({ at: Date.now(), tools: [{ name: "COMPOSIO_SEARCH_TOOLS", inputSchema: {} }, { name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema: {} }] }),
      learned: () => state.learned,
      putLearned: (l: LearnedTool[]) => void (state.learned = l),
    }
    const background: Promise<unknown>[] = []
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/toolkits?")) return Response.json({ items: [] }, { status: state.developerStatus })
      if (String(url).startsWith("https://backend.composio.dev/")) return Response.json({ tags: state.tags })
      const body = JSON.parse(String(init?.body)) as { id: number; params: { name: string; arguments: unknown } }
      state.sent.push(body.params)
      return new Response(text(state.replies.shift()).replace('"__ID__"', String(body.id)), { headers: { "content-type": SSE } })
    }) as unknown as typeof fetch
    const connection = new ComposioConnection(store as unknown as ComposioStore, fetcher, (work) => background.push(work))
    return { state, connection, background }
  }
  type Tool = { name: string; description: string; execute: (a: unknown, api: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }

  test("a searched tool that runs successfully becomes a direct tool that skips the search", async () => {
    const { state, connection } = setup()
    state.replies.push(searchBody, ran("COMPOSIO_SEARCH_WEB", true))
    await connection.call("COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: "search the web" }] })
    await connection.call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: { query: "bun" } }] })
    expect(state.learned.map((t) => [t.slug, t.toolkit, t.inputSchema])).toEqual([["COMPOSIO_SEARCH_WEB", "composio_search", webSchema]])

    const tools = (await connection.tools())!
    const ext = composioExtension(tools, (name, args) => connection.call(name, args)).tools as unknown as Tool[]
    expect(ext.map((t) => t.name)).toEqual(["composio_search_tools", "composio_multi_execute_tool", "composio_search_web"])
    expect(learnedNote(tools)).toBe("connected-app tools you can call directly, no search needed: composio_search_web.")
    const web = ext[2]!
    expect(effectOf(web as never)).toBe("external")
    expect(web.description).toBe("Search the web. (composio_search through composio, call it directly)")

    state.replies.push(ran("COMPOSIO_SEARCH_WEB", true))
    const out = await web.execute({ query: "who maintains bun" }, { conversationId: "c", callId: "1" })
    expect(state.sent.at(-1)).toEqual({ name: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: { query: "who maintains bun" } }], sync_response_to_workbench: false, thought: "direct call" } })
    expect(out.isError).toBeFalsy()
    expect(JSON.parse(out.content[0]!.text)).toEqual(ran("", true).data.results[0]!.response)
  })

  test("a learned tool Composio's catalog tags read-only is a read, safe to replay; others stay external", async () => {
    for (const [tags, effect, replay] of [[["readOnlyHint", "openWorldHint"], "read", "safe"], [["createHint"], "external", "unsafe"]] as const) {
      const { state, connection, background } = setup([...tags])
      state.replies.push(searchBody, ran("COMPOSIO_SEARCH_WEB", true))
      await connection.call("COMPOSIO_SEARCH_TOOLS", {})
      await connection.call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: {} }] })
      await Promise.all(background)
      const web = (composioExtension((await connection.tools())!, async () => ({ content: [] })).tools as unknown as { replay: string }[])[2]!
      expect([effectOf(web as never), web.replay]).toEqual([effect, replay])
    }
  })

  test("a developer key Composio rejects stores nothing and is never echoed", async () => {
    const { state, connection } = setup()
    state.developerStatus = 401
    const err = await connection.setDeveloperKey("ak_secret").catch((e) => e)
    expect([err.message, state.developer]).toEqual([DEVELOPER_REJECTED, undefined])
    expect(connection.status().developer).toBe(false)
  })

  test("adding a developer key classifies tools learned without one, which changes the signature", async () => {
    const { state, connection, background } = setup()
    state.replies.push(searchBody, ran("COMPOSIO_SEARCH_WEB", true))
    await connection.call("COMPOSIO_SEARCH_TOOLS", {})
    await connection.call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: {} }] })
    await Promise.all(background)
    expect(state.learned[0]!.readOnly).toBeUndefined()
    const before = connection.signature()

    state.tags = ["readOnlyHint"]
    expect((await connection.setDeveloperKey("ak_good")).developer).toBe(true)
    await Promise.all(background)
    expect(state.learned[0]!.readOnly).toBe(true)
    expect(connection.signature()).not.toBe(before)
  })

  test("a failed run teaches nothing, and a failed direct call is a tool error with Composio's text", async () => {
    const { state, connection } = setup()
    state.replies.push(searchBody, ran("COMPOSIO_SEARCH_WEB", false))
    await connection.call("COMPOSIO_SEARCH_TOOLS", {})
    await connection.call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: {} }] })
    expect(state.learned).toEqual([])

    const [web] = composioExtension([{ name: "COMPOSIO_SEARCH_WEB", inputSchema: webSchema, direct: { slug: "COMPOSIO_SEARCH_WEB", toolkit: "composio_search" } }], async () => ({ content: [{ type: "text", text: JSON.stringify(ran("COMPOSIO_SEARCH_WEB", false)) }] })).tools as unknown as Tool[]
    const out = await web!.execute({ query: "x" }, { conversationId: "c", callId: "1" })
    expect(out).toEqual({ content: [{ type: "text", text: "no connection" }], isError: true })
  })

  test("a learned tool whose run fails is forgotten, so the next run searches again", async () => {
    const { state, connection } = setup()
    const args = { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: { query: "bun" } }] }
    state.replies.push(searchBody, ran("COMPOSIO_SEARCH_WEB", true), ran("COMPOSIO_SEARCH_WEB", false))
    await connection.call("COMPOSIO_SEARCH_TOOLS", {})
    await connection.call("COMPOSIO_MULTI_EXECUTE_TOOL", args)
    expect((await connection.tools())!.map((t) => t.name)).toContain("COMPOSIO_SEARCH_WEB")
    await connection.call("COMPOSIO_MULTI_EXECUTE_TOOL", args)
    expect((await connection.tools())!.map((t) => t.name)).not.toContain("COMPOSIO_SEARCH_WEB")
  })

  test("a learned tool whose name is a meta tool's is left out", () => {
    const tools = composioExtension(
      [{ name: "COMPOSIO_SEARCH_TOOLS", inputSchema: {} }, { name: "COMPOSIO_SEARCH_TOOLS", inputSchema: {}, direct: { slug: "COMPOSIO_SEARCH_TOOLS", toolkit: "composio" } }],
      async () => ({ content: [] }),
    ).tools
    expect(tools?.length).toBe(1)
  })

  test("learned tools keep the most recently used, upsert by slug keeping their class, and cap", () => {
    const tool = (slug: string, usedAt: number): LearnedTool => ({ slug, toolkit: "t", description: "", inputSchema: {}, usedAt })
    const full = Array.from({ length: LEARNED_MAX }, (_, i) => tool(`T${i}`, i))
    const next = remember(full, [tool("T3", 0), tool("NEW", 0)], 1000)
    expect(next.length).toBe(LEARNED_MAX)
    expect(next.slice(0, 2).map((t) => [t.slug, t.usedAt])).toEqual([["T3", 1000], ["NEW", 1000]])
    expect(next.some((t) => t.slug === "T0")).toBe(false)
    expect(remember(next, [tool("T3", 0)], 1000)).toEqual(next)
    expect(remember([{ ...tool("A", 0), readOnly: true }], [tool("A", 0)], 5)[0]!.readOnly).toBe(true)
  })
})

describe("learned signature", () => {
  test("the same tools in another order give the same signature", () => {
    const tool = (name: string) => ({ name, description: "", inputSchema: {}, direct: { slug: name, toolkit: "x" } })
    expect(learnedSignature([tool("B_TWO"), tool("A_ONE")])).toBe(learnedSignature([tool("A_ONE"), tool("B_TWO")]))
  })
})
