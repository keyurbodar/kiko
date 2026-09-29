import { describe, expect, test } from "bun:test"
import type { ChatMessage } from "../../lib/types"
import {
  DRIFT_EPSILON,
  driftCompensation,
  estimateRowHeight,
  estimateTimelineItemHeight,
  rowReserveStyle,
} from "./heights"
import type { TimelineItem } from "./grouping"

const AT = new Date(2024, 4, 13, 9, 30).getTime()

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  threadId: "bot-ada",
  sender: "bot",
  botId: "ada",
  body: "short body",
  sentAt: AT,
  ...overrides,
})

const row = (
  msg: ChatMessage,
  flags: Partial<Extract<TimelineItem, { kind: "message" }>> = {},
): Extract<TimelineItem, { kind: "message" }> => ({
  kind: "message",
  key: msg.id,
  message: msg,
  isContinuation: false,
  isFollowedByContinuation: false,
  ...flags,
})

const divider: TimelineItem = { kind: "day-divider", key: "d", dayStart: AT }

describe("estimateRowHeight", () => {
  test("a short root row never reserves less than the flat floor", () => {
    expect(
      estimateRowHeight("ok", {
        isContinuation: false,
        isFollowedByContinuation: true,
        isReply: false,
      }),
    ).toBe(60)
  })

  test("a continuation row floors lower than a root row", () => {
    expect(
      estimateRowHeight("ok", {
        isContinuation: true,
        isFollowedByContinuation: true,
        isReply: false,
      }),
    ).toBe(28)
  })

  test("a long body reserves more than a short one", () => {
    const flags = { isContinuation: false, isFollowedByContinuation: true, isReply: false }
    expect(estimateRowHeight("a".repeat(200), flags)).toBe(83)
    expect(estimateRowHeight("a".repeat(500), flags)).toBe(143)
  })

  test("the last row of a run reserves the run's trailing padding", () => {
    const base = { isContinuation: false, isReply: false }
    const midRun = estimateRowHeight("a".repeat(200), { ...base, isFollowedByContinuation: true })
    const endOfRun = estimateRowHeight("a".repeat(200), { ...base, isFollowedByContinuation: false })
    expect(endOfRun - midRun).toBe(10)
  })

  test("a reply reserves room for its quoted parent", () => {
    const base = { isContinuation: false, isFollowedByContinuation: true }
    const withQuote = estimateRowHeight("a".repeat(200), { ...base, isReply: true })
    const without = estimateRowHeight("a".repeat(200), { ...base, isReply: false })
    expect(withQuote - without).toBe(24)
  })

  test("a blank body reserves nothing for text", () => {
    const flags = { isContinuation: false, isFollowedByContinuation: true, isReply: false }
    expect(estimateRowHeight("   ", flags)).toBe(estimateRowHeight("", flags))
  })
})

describe("estimateTimelineItemHeight", () => {
  test("a day divider reserves a fixed short row", () => {
    expect(estimateTimelineItemHeight(divider)).toBe(36)
  })

  test("a divider is shorter than any message row", () => {
    expect(estimateTimelineItemHeight(divider)).toBeLessThan(
      estimateTimelineItemHeight(row(message())),
    )
  })

  test("the reserve carries the auto keyword so the browser keeps the measured size", () => {
    expect(rowReserveStyle(divider)).toEqual({ "contain-intrinsic-size": "auto 36px" })
    expect(rowReserveStyle(row(message()))).toEqual({
      "contain-intrinsic-size": `auto ${estimateTimelineItemHeight(row(message()))}px`,
    })
  })
})

describe("driftCompensation", () => {
  test("the reader parked at the bottom is left to the bottom anchor", () => {
    expect(driftCompensation(120, true)).toBe(0)
  })

  test("sub-pixel movement is not a drift", () => {
    expect(driftCompensation(DRIFT_EPSILON, false)).toBe(0)
    expect(driftCompensation(-DRIFT_EPSILON, false)).toBe(0)
  })

  test("a real downward drift scrolls down by exactly that much", () => {
    expect(driftCompensation(117, false)).toBe(117)
  })

  test("a real upward drift scrolls up by exactly that much", () => {
    expect(driftCompensation(-117, false)).toBe(-117)
  })

  test("an unmeasurable drift is ignored", () => {
    expect(driftCompensation(Number.NaN, false)).toBe(0)
  })
})
