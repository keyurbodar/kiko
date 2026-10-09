import { describe, expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable"
import { htmlToText, WEB_TOOL_EFFECTS, webExtension } from "../src/agent/extensions/web"
import type { Fetcher } from "@kiko/durable/safe-fetch"

const context = BACKGROUND_CONTEXT

const api = { agent: async () => ({ model: { provider: "faux", modelId: "faux-1" } }) } as unknown as ToolExecutionApi

function tools(extension: { tools?: readonly ToolRegistration[] }) {
  const byName = new Map((extension.tools ?? []).map((t) => [t.name, t]))
  return async (name: string, args: Record<string, unknown>) => {
    const result = await byName.get(name)!.execute(args as never, api, context)
    const text = (result.content ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("")
    return { ...result, text }
  }
}

test("web_fetch declares a read effect", () => {
  expect(WEB_TOOL_EFFECTS).toEqual({ web_fetch: "read" })
})

describe("web_fetch", () => {
  const page = `<html><head><title>fixture page</title><style>p{}</style></head><body><script>steal()</script><h1>hello</h1><p>the word is <b>tangerine</b> &amp; more</p></body></html>`
  const fetcher: Fetcher = async (url) => {
    const u = new URL(url)
    if (u.hostname === "cloudflare-dns.com") {
      const a = u.searchParams.get("type") === "A"
      return Response.json({ Status: 0, Answer: a ? [{ type: 1, data: "93.184.216.34" }] : [] })
    }
    if (u.pathname === "/bin") return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } })
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
  }
  const call = tools(webExtension(fetcher))

  test("returns the page as text, marked untrusted", async () => {
    const result = await call("web_fetch", { url: "https://example.test/page" })
    expect(result.isError).toBe(false)
    expect(result.text).toContain("the word is tangerine & more")
    expect(result.text).toContain("fixture page")
    expect(result.text).not.toContain("steal()")
    expect(result.text).not.toContain("<")
    expect(result.details).toEqual({ untrusted: true, source: "https://example.test/page" })
  })

  test("the safe fetcher refuses private hosts and other schemes", async () => {
    for (const url of ["http://localhost:8787/", "http://127.0.0.1/", "http://169.254.169.254/latest", "file:///etc/passwd"]) {
      const result = await call("web_fetch", { url })
      expect(result.isError).toBe(true)
      expect(result.text).toStartWith("could not fetch")
    }
  })

  test("a binary answer is refused", async () => {
    expect((await call("web_fetch", { url: "https://example.test/bin" })).isError).toBe(true)
  })

  test("htmlToText puts blocks on their own lines, with at most one blank line between", () => {
    expect(htmlToText("<ul><li>a</li><li>b&#x21;</li></ul>")).toBe("a\n\nb!")
  })
})
