import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../lib/types"
import { buildTimelineItems, unfoldedRuns } from "./grouping"

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

const replied = (seq: number, at: number, steps: number, stepAfter: number): ChatMessage => ({
  ...said(seq, at, "bot"),
  steps,
  stepAfter,
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

  it("folds a background run into the reply its agent posts next", () => {
    const items = buildTimelineItems([
      said(1, START, "user"),
      background(2, START + 60_000),
      replied(3, START + 120_000, 3, 2),
    ])

    expect(items.filter((item) => item.kind === "background")).toHaveLength(0)
    const reply = items.find((item) => item.kind === "message" && item.message.id === "3.room")
    expect(reply?.kind === "message" && reply.foldedRuns?.map((m) => m.seq)).toEqual([2])
  })

  it("keeps a background run when the owner speaks before the agent replies", () => {
    const items = buildTimelineItems([
      said(1, START, "user"),
      background(2, START + 60_000),
      said(3, START + 120_000, "user"),
      replied(4, START + 180_000, 1, 3),
    ])

    const backgroundItems = items.filter((item) => item.kind === "background")
    expect(backgroundItems).toHaveLength(1)
    expect(backgroundItems[0]?.kind === "background" && backgroundItems[0].messages.map((m) => m.seq)).toEqual([2])
    const reply = items.find((item) => item.kind === "message" && item.message.id === "4.room")
    expect(reply?.kind === "message" && reply.foldedRuns).toBeUndefined()
  })

  it("folds every background run since the last post from someone else", () => {
    const items = buildTimelineItems([
      background(1, START),
      background(2, START + 60_000),
      replied(3, START + 120_000, 5, 2),
    ])

    const reply = items.find((item) => item.kind === "message")
    expect(reply?.kind === "message" && reply.foldedRuns?.map((m) => m.seq)).toEqual([1, 2])
    expect(items.filter((item) => item.kind === "background")).toHaveLength(0)
  })

  it("leaves a waiting background run to the live tree of the agent still working on it", () => {
    const messages = [said(1, START, "user"), background(2, START + 60_000)]

    expect(buildTimelineItems(messages, undefined, { carried: new Set(["kiko"]) }).map((i) => i.kind)).not.toContain(
      "background",
    )
    expect(buildTimelineItems(messages, undefined, { carried: new Set(["other"]) }).map((i) => i.kind)).toContain(
      "background",
    )
  })
})

describe("unfoldedRuns", () => {
  it("reports the background runs still waiting for their agent's next post", () => {
    expect(unfoldedRuns([said(1, START, "user"), background(2, START + 60_000)], "kiko").map((m) => m.seq)).toEqual([2])
    expect(unfoldedRuns([background(1, START), said(2, START + 60_000, "user")], "kiko")).toEqual([])
    expect(unfoldedRuns([background(1, START), replied(2, START + 60_000, 1, 1)], "kiko")).toEqual([])
  })
})
