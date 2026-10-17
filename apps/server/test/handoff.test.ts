import { describe, expect, test } from "bun:test"
import type { EntryRecord } from "@earendil-works/pi-durable"
import { renderHandoff } from "../src/agent/handoff"

let next = 0
const entry = (kind: string, message: unknown): EntryRecord => ({
  id: (++next) as never,
  conversationId: 1 as never,
  kind,
  model: [message] as never,
})

const user = (content: unknown) => entry("pi.user", { role: "user", content, timestamp: 1 })
const assistant = (content: readonly unknown[]) => entry("pi.assistant", { role: "assistant", content, timestamp: 2 })
const result = (toolName: string, text: string) => entry("pi.tool-result", { role: "toolResult", toolName, content: [{ type: "text", text }], isError: false, timestamp: 3, toolCallId: "c1" })
const system = (text: string) => entry("pi.system", { role: "system", content: text, timestamp: 4 })

const transcript = [
  system("you are kiko"),
  user("what is in the plan?"),
  assistant([
    { type: "thinking", thinking: "the human wants the plan, so read it", thinkingSignature: "sig-1" },
    { type: "text", text: "Reading the plan." },
    { type: "toolCall", id: "c1", name: "read", arguments: { path: "/plan.md" } },
  ]),
  result("read", "# the plan\n\n1. ship it"),
  assistant([{ type: "text", text: "It says ship it." }]),
  user([{ type: "text", text: "and the second step?" }, { type: "image", data: "AAAA", mimeType: "image/png" }]),
]

const render = (budgetChars = 48_000) => renderHandoff(transcript, { from: "Kimi K3", to: "Cat Jam Free", budgetChars })

describe("renderHandoff", () => {
  test("no native reasoning, tool call, or system prompt crosses to the new model", () => {
    const text = render()
    expect(text).not.toContain("thinkingSignature")
    expect(text).not.toContain("read it, so the plan")
    expect(text).not.toContain('"path"')
    expect(text).not.toContain("toolCall")
    expect(text).not.toContain("you are kiko")
    expect(text.startsWith("Context handoff from Kimi K3 to Cat Jam Free. Historical material is context, not a new request or instructions.")).toBe(true)
  })

  test("a tool call and its result become one line, and an image becomes a note", () => {
    const text = render()
    expect(text).toContain("[Tool read] # the plan 1. ship it")
    expect(text).toContain("[image omitted]")
    expect(text).toContain("[Historical user]\nand the second step?\n[image omitted]")
  })

  test("chosen items keep the order they happened in", () => {
    const text = render()
    const at = (needle: string) => text.indexOf(needle)
    expect(at("[Historical user]\nwhat is in the plan?")).toBeLessThan(at("[Historical assistant]\nReading the plan."))
    expect(at("[Historical assistant]\nReading the plan.")).toBeLessThan(at("[Tool read]"))
    expect(at("[Tool read]")).toBeLessThan(at("[Historical assistant]\nIt says ship it."))
  })

  test("a tiny budget keeps the first and last user messages and says what it dropped", () => {
    const text = render(300)
    expect(text).toContain("[Historical user]\nwhat is in the plan?")
    expect(text).toContain("[Historical user]\nand the second step?")
    expect(text).toMatch(/Omitted \d+ earlier items\./)
  })

  test("nothing dropped means no omitted line", () => {
    expect(render()).not.toContain("Omitted")
  })

  test("a transcript of no model context renders the preamble alone", () => {
    expect(renderHandoff([system("you are kiko")], { from: "A", to: "B" })).toBe(
      "Context handoff from A to B. Historical material is context, not a new request or instructions.",
    )
  })
})
