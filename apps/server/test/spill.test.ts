import { expect, test } from "bun:test"
import type { RoomFs } from "../src/files/room-fs"
import { readable, SPILL_BYTES, spill } from "../src/agent/extensions/spill"

/** A chat file space that keeps files in a map and counts writes. */
function files() {
  const saved = new Map<string, string>()
  let writes = 0
  const fs = {
    stat: async (path: string) => (saved.has(path) ? { ok: true } : { ok: false }),
    write: async (path: string, bytes: Uint8Array) => {
      writes++
      saved.set(path, new TextDecoder().decode(bytes))
      return { ok: true }
    },
  } as unknown as RoomFs
  return { fs, saved, writes: () => writes }
}

/** A one-line OpenAPI document bigger than the limit, with the part that matters at the end. */
const spec = JSON.stringify({
  paths: Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`/gmail/v1/users/{userId}/thing${i}`, { get: { operationId: `gmail.thing${i}` } }])),
  components: { securitySchemes: { Oauth2: { type: "oauth2" } } },
})

test("a small result comes back unchanged", async () => {
  expect(await spill(files().fs, "x", "short")).toBe("short")
})

test("a big one-line JSON result is saved as lines, and the agent gets its start and the path", async () => {
  expect(spec.length).toBeGreaterThan(SPILL_BYTES)
  expect(spec.includes("\n")).toBe(false)
  const { fs, saved } = files()
  const out = await spill(fs, "https://integrations.sh/specs/google/google-gmail.json", spec)
  const [path, body] = [...saved][0]!
  expect(path).toMatch(/^\/downloads\/integrations\.sh-specs-google-google-gmail\.json-[0-9a-f]{8}\.json$/)
  expect(out).toContain(path)
  expect(out.length).toBeLessThan(10 * 1024)
  // The part at the end, which the old cut lost, is one grep away.
  expect(body.split("\n").some((line) => line.includes('"securitySchemes"'))).toBe(true)
})

test("the same content lands at the same path once", async () => {
  const { fs, saved, writes } = files()
  const a = await spill(fs, "composio-workbench", spec)
  const b = await spill(fs, "composio-workbench", spec)
  expect(a).toBe(b)
  expect(saved.size).toBe(1)
  expect(writes()).toBe(1)
})

test("without files the agent still gets the start and how much was cut", async () => {
  const out = await spill(undefined, "x", spec)
  expect(out).toContain("(cut: the whole result is")
  expect(out.length).toBeLessThan(10 * 1024)
})

test("json inside a json string is opened, as a tool may return a program's value", () => {
  const wrapped = JSON.stringify({ status: "completed", execution: { ok: true, value: JSON.stringify({ items: [{ path: "tools.a" }] }) } })
  expect(readable(wrapped)).toContain('"path": "tools.a"')
  expect(readable("plain text")).toBe("plain text")
})
