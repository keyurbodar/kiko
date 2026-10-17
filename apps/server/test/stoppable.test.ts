import { expect, test } from "bun:test"
import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { stoppable } from "@kiko/agent/effects"
import { FAKE_TOOLS } from "../src/agent/dev-fake"
import { filesExtension } from "../src/agent/extensions/files"

const files = new Map((filesExtension({ acceptsImages: () => false, touched: () => {} }).tools ?? []).map((t) => [t.name, t]))
const real = (name: string) => {
  const tool = files.get(name)
  if (!tool) throw new Error(`no files tool ${name}`)
  return tool
}

test("a read and bash may be stopped mid-call", () => {
  for (const name of ["read", "ls", "bash"]) expect(stoppable(real(name))).toBe(true)
  expect(stoppable(FAKE_TOOLS.fake_fetch)).toBe(true)
})

test("a write, a message, and an outside call run to their end", () => {
  for (const name of ["write", "edit", "rm", "mv", "cp", "mkdir"]) expect(stoppable(real(name))).toBe(false)
  for (const tool of [FAKE_TOOLS.fake_note, FAKE_TOOLS.fake_ask, FAKE_TOOLS.fake_send]) expect(stoppable(tool)).toBe(false)
})

test("a tool with no declared effect is not stopped", () => {
  expect(stoppable(defineTool({ name: "undeclared", description: "none", parameters: Type.Object({}), execute: async () => ({ output: [] }) }))).toBe(false)
})
