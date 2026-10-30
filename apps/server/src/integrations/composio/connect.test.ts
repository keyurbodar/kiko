import { afterEach, describe, expect, it, vi } from "vitest"
import { type ComposioTool, ComposioError } from "./client"
import { ComposioConnection } from "./connect"
import type { LearnedTool } from "./learn"

type Store = ConstructorParameters<typeof ComposioConnection>[0]

function memoryStore(options: { listing?: { at: number; tools: ComposioTool[] }; learned?: LearnedTool[] } = {}) {
  let target: { key: string; url: string; session: string } | undefined = {
    key: "k",
    url: "https://backend.composio.dev/mcp-one",
    session: "s1",
  }
  const store = {
    generation: 0,
    target: async () => target,
    connected: () => true,
    listing: () => options.listing,
    putListing: vi.fn(),
    learned: () => options.learned ?? [],
    putLearned: vi.fn(),
    putSession: vi.fn((session: { id: string; url: string }) => {
      target = target && { key: target.key, url: session.url, session: session.id }
    }),
  }
  return store as unknown as Store
}

const NOW = 1_000_000_000

const tool = (name: string, readOnly = false): ComposioTool => ({
  name,
  inputSchema: {},
  ...(readOnly ? { readOnly: true } : {}),
})

const rpc = (id: unknown, result: unknown, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status })

afterEach(() => {
  vi.restoreAllMocks()
})

describe("composio session", () => {
  it("does not replay an unsafe tool call after the session is gone", async () => {
    const fetcher = vi.fn(async () => new Response("gone", { status: 404 }))
    const connection = new ComposioConnection(
      memoryStore({ listing: { at: NOW, tools: [tool("GMAIL_SEND_EMAIL")] } }),
      async () => "user",
      fetcher as unknown as typeof fetch,
    )

    await expect(connection.call("GMAIL_SEND_EMAIL", {})).rejects.toBeInstanceOf(ComposioError)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("renews and replays a read-only tool call after the session is gone", async () => {
    const seen: string[] = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as { id: number }
      if (url.includes("/tool_router/session")) {
        seen.push("renew")
        return new Response(JSON.stringify({ session_id: "s2", mcp: { url: "https://backend.composio.dev/mcp-two" } }))
      }
      seen.push(url)
      if (url.endsWith("mcp-one")) return new Response("gone", { status: 410 })
      return rpc(body.id, { content: [{ type: "text", text: "ok" }] })
    }
    const connection = new ComposioConnection(
      memoryStore({ listing: { at: NOW, tools: [tool("GMAIL_LIST", true)] } }),
      async () => "user",
      fetcher as unknown as typeof fetch,
    )

    await expect(connection.call("GMAIL_LIST", {})).resolves.toEqual({ content: [{ type: "text", text: "ok" }] })
    expect(seen).toEqual(["https://backend.composio.dev/mcp-one", "renew", "https://backend.composio.dev/mcp-two"])
  })
})

describe("composio tool list", () => {
  it("keeps serving a stale list within the bound and logs the failed refresh", async () => {
    let report!: (message: string) => void
    const logged = new Promise<string>((resolve) => {
      report = resolve
    })
    vi.spyOn(console, "error").mockImplementation((message: unknown) => report(String(message)))
    const tools = [tool("GMAIL_LIST")]
    const connection = new ComposioConnection(
      memoryStore({ listing: { at: NOW - 11 * 60_000, tools } }),
      async () => "user",
      (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
    )

    await expect(connection.tools(NOW)).resolves.toEqual(tools)
    await expect(logged).resolves.toContain("composio tool list refresh failed")
  })

  it("stops trusting a list older than the bound when the refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const connection = new ComposioConnection(
      memoryStore({ listing: { at: NOW - 25 * 60 * 60_000, tools: [tool("GMAIL_LIST")] } }),
      async () => "user",
      (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
    )

    await expect(connection.tools(NOW)).rejects.toBeInstanceOf(ComposioError)
  })
})
