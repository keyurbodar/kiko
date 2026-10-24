import type { HumanAsk } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "../lib/types"
import { needsOf } from "./needs"

const ask = (text: string): HumanAsk => ({ id: "ask-1", from: "kiko", text, messageId: "m-1" }) as unknown as HumanAsk

const failure = (retry: boolean): ChatMessage =>
  ({
    id: "m-9",
    threadId: "r-1",
    sender: "bot",
    body: "Kiko could not answer. No key for this model.",
    sentAt: 1,
    event: {
      kind: "run_error",
      slug: "kiko",
      reason: "no_key",
      actions: retry ? ["retry"] : ["open_settings"],
      private: true,
    },
  }) as unknown as ChatMessage

const base = { activeId: "r-1", asks: [], messages: [], retry: () => {}, elsewhere: new Map<string, string>() }

describe("needsOf", () => {
  it("lists the open chat when an agent is waiting on an answer", () => {
    const needs = needsOf({ ...base, asks: [ask("Approve the refund?")] })
    expect(needs.get("r-1")).toEqual({ kind: "ask", text: "Approve the refund?" })
  })

  it("lists the open chat when its latest message is a failed run and wires retry to that message", () => {
    const retry = vi.fn()
    const need = needsOf({ ...base, messages: [failure(true)], retry }).get("r-1")
    expect(need?.kind).toBe("failed")
    need?.retry?.()
    expect(retry).toHaveBeenCalledWith("m-9")
  })

  it("offers no retry when the failure has none", () => {
    expect(needsOf({ ...base, messages: [failure(false)] }).get("r-1")?.retry).toBeUndefined()
  })

  it("lists nothing for a calm chat", () => {
    expect(needsOf(base).size).toBe(0)
  })

  it("keeps failures signalled for other chats and drops one for the chat that is open", () => {
    const elsewhere = new Map([
      ["r-2", "Kiko could not answer."],
      ["r-1", "stale"],
    ])
    expect([...needsOf({ ...base, elsewhere }).keys()]).toEqual(["r-2"])
  })
})
