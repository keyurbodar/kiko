import type { AssistantMessage, Message } from "@earendil-works/pi-ai"
import type { EntryRecord } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { renderHandoff } from "./handoff"

const entry = (model: Message, at: number): EntryRecord => ({
  id: `e${at}` as never,
  conversationId: "c" as never,
  kind: "pi.message",
  model: [model],
})

const user = (text: string) => ({ role: "user", content: text, timestamp: 0 }) as Message

const assistant = (text: string): Message =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4.1-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  }) as AssistantMessage

const long = (head: string) => `${head} ${"x".repeat(2_000)}`

describe("renderHandoff", () => {
  it("keeps a short conversation whole", () => {
    const text = renderHandoff([entry(user("hi"), 0), entry(assistant("hello"), 1)], { from: "a", to: "b" })
    expect(text).toContain("[Historical user]\nhi")
    expect(text).toContain("[Historical assistant]\nhello")
  })

  it("truncates the last request and answer instead of dropping them when they do not fit", () => {
    const text = renderHandoff(
      [
        entry(user("old question"), 0),
        entry(assistant("old answer"), 1),
        entry(user(long("request")), 2),
        entry(assistant(long("answer")), 3),
      ],
      { from: "a", to: "b", budgetChars: 500 },
    )
    expect(text).toContain("[Historical user]\nrequest")
    expect(text).toContain("[Historical assistant]\nanswer")
    expect(text).toContain("…")
    expect(text.length).toBeLessThanOrEqual(500)
  })
})
