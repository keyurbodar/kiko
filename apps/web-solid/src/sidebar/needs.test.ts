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

const base = { activeId: "r-1", asks: [], messages: [], retry: () => {}, known: new Map<string, string>() }

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

  it("keeps known failures and drops the open chat's once its messages load without one", () => {
    const known = new Map([
      ["r-2", "Kiko could not answer."],
      ["r-1", "stale"],
    ])
    const calm = { id: "m-1", threadId: "r-1", sender: "user", body: "hi", sentAt: 1 } as unknown as ChatMessage
    expect([...needsOf({ ...base, known, messages: [calm] }).keys()]).toEqual(["r-2"])
  })

  it("keeps the open chat's known failure while its messages are still loading", () => {
    const known = new Map([["r-1", "Kiko could not answer."]])
    const other = { id: "m-1", threadId: "r-9", sender: "user", body: "hi", sentAt: 1 } as unknown as ChatMessage
    expect(needsOf({ ...base, known, messages: [other] }).get("r-1")?.kind).toBe("failed")
    expect(needsOf({ ...base, known }).get("r-1")?.kind).toBe("failed")
  })
})
