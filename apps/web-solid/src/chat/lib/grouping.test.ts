import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../lib/types"
import { buildTimelineItems } from "./grouping"

const ROOM = "room"
const HOUR = 3_600_000
const START = Date.UTC(2026, 9, 26, 9)

const background = (seq: number, at: number): ChatMessage => ({
  id: `${seq}.room`,
  threadId: ROOM,
  sender: "bot",
  botId: "kiko",
  body: "",
  sentAt: at,
  seq,
  steps: 2,
  stepAfter: seq - 1,
  event: { kind: "activity", agent: "kiko" as AgentSlug, private: true },
})

const said = (seq: number, at: number, sender: "user" | "bot"): ChatMessage => ({
  id: `${seq}.room`,
  threadId: ROOM,
  sender,
  ...(sender === "bot" ? { botId: "kiko" } : {}),
  body: `message ${seq}`,
  sentAt: at,
  seq,
})

describe("buildTimelineItems", () => {
  it("folds an agent's back-to-back background runs into one line with no time breaks between them", () => {
    const items = buildTimelineItems([
      said(1, START, "user"),
      background(2, START + HOUR),
      background(3, START + 2 * HOUR),
      background(4, START + 3 * HOUR),
      said(5, START + 3 * HOUR + 60_000, "user"),
    ])

    const kinds = items.map((item) => item.kind)
    expect(kinds.filter((kind) => kind === "background")).toHaveLength(1)
    expect(kinds.filter((kind) => kind === "day-divider")).toHaveLength(1)
    const folded = items.find((item) => item.kind === "background")
    expect(folded?.kind === "background" && folded.messages.map((m) => m.seq)).toEqual([2, 3, 4])
  })

  it("starts a new background line once someone speaks in between", () => {
    const items = buildTimelineItems([
      background(1, START),
      said(2, START + 60_000, "user"),
      background(3, START + 120_000),
    ])

    expect(items.filter((item) => item.kind === "background")).toHaveLength(2)
  })
})
