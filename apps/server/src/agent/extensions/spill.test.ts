import { describe, expect, it } from "vitest"
import type { RoomFs } from "../../files/room-fs"
import { spill } from "./spill"

const log = [
  "build started",
  ...Array.from({ length: 4000 }, (_, i) => `step ${i}: compiling module number ${i}`),
  "error: cannot find name 'widget' at src/app.ts:42",
].join("\n")

function memoryFs(): { fs: RoomFs; saved: Map<string, Uint8Array> } {
  const saved = new Map<string, Uint8Array>()
  const fs = {
    stat: async (path: string) => ({ ok: saved.has(path) }),
    write: async (path: string, bytes: Uint8Array) => {
      saved.set(path, bytes)
      return { ok: true }
    },
  } as unknown as RoomFs
  return { fs, saved }
}

describe("spill", () => {
  it("returns short output as it is", async () => {
    expect(await spill(memoryFs().fs, "bash", "ok")).toBe("ok")
  })

  it("keeps the start and the end of a long result and names the saved file between them", async () => {
    const { fs, saved } = memoryFs()
    const out = await spill(fs, "bash", log)
    const [path] = [...saved.keys()]

    expect(out.startsWith("build started\n")).toBe(true)
    expect(out.trimEnd().endsWith("error: cannot find name 'widget' at src/app.ts:42")).toBe(true)
    expect(path).toMatch(/^\/downloads\/bash-[0-9a-f]{8}\.txt$/)
    const marker = out.indexOf(path ?? "missing")
    expect(marker).toBeGreaterThan(out.indexOf("step 1:"))
    expect(marker).toBeLessThan(out.indexOf("error: cannot find name"))
    expect(out.length).toBeLessThan(10 * 1024)
  })

  it("keeps both ends when the result cannot be saved", async () => {
    const out = await spill(undefined, "bash", log)

    expect(out.startsWith("build started\n")).toBe(true)
    expect(out.trimEnd().endsWith("src/app.ts:42")).toBe(true)
  })

  it("keeps both ends of one long line", async () => {
    const out = await spill(undefined, "page", `begin ${"x".repeat(60_000)} finish`)

    expect(out.startsWith("begin x")).toBe(true)
    expect(out.endsWith("x finish")).toBe(true)
    expect(out.length).toBeLessThan(4 * 1024)
  })
})
