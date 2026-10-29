import { describe, expect, it } from "vitest"
import { memoryExtensions, type MemoryPort } from "./tools"

const encoder = new TextEncoder()

function zoomTool(found: string | null) {
  const port: MemoryPort = {
    note: async () => ({ ok: true, pos: 0 }),
    recall: async () => "",
    zoom: async () => found,
    captures: () => true,
  }
  const tool = memoryExtensions(port)
    .flatMap((extension) => extension.tools ?? [])
    .find((candidate) => candidate.name === "zoom")
  if (!tool) throw new Error("no zoom tool")
  return tool
}

const said = (out: { output?: readonly { type: string; text?: string }[] }) =>
  (out.output ?? []).map((part) => part.text ?? "").join("")

describe("zoom", () => {
  it("bounds a large span and points at its own ids", async () => {
    const lines = Array.from({ length: 2_000 }, (_, i) => `#${i} 12:00 human: ${"x".repeat(200)}`)
    const out = await zoomTool(lines.join("\n")).execute({ id: "chat:0-4095" }, {} as never, {} as never)
    const body = said(out)
    expect(encoder.encode(body).length).toBeLessThan(25 * 1024)
    expect(body.startsWith(`${lines[0]}\n`)).toBe(true)
    expect(body).toContain("zoom one of the # ids above")
  })

  it("leaves a small span whole", async () => {
    const out = await zoomTool("#12 12:00 human: hi").execute({ id: "chat:12" }, {} as never, {} as never)
    expect(said(out)).toBe("#12 12:00 human: hi")
  })
})
