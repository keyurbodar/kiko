import { describe, expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable"
import type { FileRef } from "@kiko/protocol"
import { FILE_TOOL_EFFECTS, type FilesPort, filesExtension, toolPath } from "../src/agent/extensions/files"
import { htmlToText, WEB_TOOL_EFFECTS, webExtension } from "../src/agent/extensions/web"
import type { Fetcher } from "../src/lib/safe-fetch"

// P8-05, architecture sections 7.5 and 18. The tools run against an in-memory port, so these tests
// check the tools' own rules: relative paths only, text or image results, untrusted marking, and
// the safe fetcher behind `web_fetch`.

const context = BACKGROUND_CONTEXT

function memoryPort(images = false): FilesPort & { files: Map<string, { bytes: Uint8Array; type: string }> } {
  const files = new Map<string, { bytes: Uint8Array; type: string }>()
  const ref = (name: string): FileRef => ({ id: name, name, size: files.get(name)!.bytes.length, type: files.get(name)!.type })
  return {
    files,
    async read(path, maxBytes) {
      const f = files.get(path)
      if (!f) return null
      const bytes = f.bytes.subarray(0, maxBytes)
      return { path, size: f.bytes.length, type: f.type, bytes, partial: bytes.length < f.bytes.length }
    },
    async write(path, bytes, type) {
      files.set(path, { bytes, type })
      return ref(path)
    },
    async list(prefix) {
      return [...files.keys()].filter((k) => k.startsWith(prefix)).sort().map(ref)
    },
    acceptsImages: () => images,
  }
}

const api = { agent: async () => ({ model: { provider: "faux", modelId: "faux-1" } }) } as unknown as ToolExecutionApi

function tools(extension: { tools?: readonly ToolRegistration[] }) {
  const byName = new Map((extension.tools ?? []).map((t) => [t.name, t]))
  return async (name: string, args: Record<string, unknown>) => {
    const result = await byName.get(name)!.execute(args as never, api, context)
    const text = (result.content ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("")
    return { ...result, text }
  }
}

describe("file tools", () => {
  test("every tool declares the effect the issue names", () => {
    expect(FILE_TOOL_EFFECTS).toEqual({ read_file: "read", write_file: "write", list_files: "read" })
    expect(WEB_TOOL_EFFECTS).toEqual({ web_fetch: "read" })
    const names = (filesExtension(memoryPort()).tools ?? []).map((t) => t.name).sort()
    expect(names).toEqual(Object.keys(FILE_TOOL_EFFECTS).sort())
  })

  test("a path with .. or a leading slash is refused, and nothing is written", async () => {
    const port = memoryPort()
    const call = tools(filesExtension(port))
    for (const path of ["../secret", "notes/../../x", "/etc/passwd", "/notes/plan.md", "notes//plan.md", "./plan.md", ""]) {
      expect(toolPath(path)).toBeNull()
      const wrote = await call("write_file", { path, content: "x" })
      expect(wrote.isError).toBe(true)
      expect(wrote.text).toStartWith("refused")
      expect((await call("read_file", { path })).isError).toBe(true)
    }
    for (const prefix of ["../", "/notes", "/"]) expect((await call("list_files", { prefix })).isError).toBe(true)
    expect(port.files.size).toBe(0)
  })

  test("write, read back, and list", async () => {
    const port = memoryPort()
    const call = tools(filesExtension(port))
    expect((await call("write_file", { path: "notes/plan.md", content: "# plan\nstep one" })).text).toBe("wrote notes/plan.md (15 bytes)")
    expect(port.files.get("notes/plan.md")!.type).toBe("text/markdown")
    await call("write_file", { path: "other.txt", content: "x" })
    const read = await call("read_file", { path: "notes/plan.md" })
    expect(read.text).toBe("# plan\nstep one")
    expect(read.details).toEqual({ untrusted: true, source: "file:notes/plan.md" })
    expect((await call("list_files", { prefix: "notes/" })).text).toBe("notes/plan.md\t15 bytes\ttext/markdown")
    expect((await call("list_files", { prefix: "" })).text.split("\n")).toHaveLength(2)
    expect((await call("read_file", { path: "notes/none.md" })).isError).toBe(true)
  })

  test("an image goes to a model that reads images, and a note to one that does not", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
    for (const images of [true, false]) {
      const port = memoryPort(images)
      port.files.set("pic.png", { bytes: png, type: "image/png" })
      const read = await tools(filesExtension(port))("read_file", { path: "pic.png" })
      expect(read.text).toBe(images ? "[image]" : "pic.png is an image (image/png, 7 bytes). this model cannot read images.")
    }
  })

  test("a binary file is not read as text", async () => {
    const port = memoryPort()
    port.files.set("blob.bin", { bytes: new Uint8Array([1, 0, 2]), type: "application/octet-stream" })
    const read = await tools(filesExtension(port))("read_file", { path: "blob.bin" })
    expect(read.isError).toBe(true)
    expect(read.text).toContain("binary")
  })
})

describe("web_fetch", () => {
  // A fetcher that answers DNS with a public address and serves one page.
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
