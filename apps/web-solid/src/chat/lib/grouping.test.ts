import { describe, expect, test } from "bun:test"
import type { ChatMessage } from "../../lib/types"
import {
  MESSAGE_GROUPING_WINDOW_MS,
  buildTimelineItems,
  dayStartOf,
  firstUnreadIndex,
  isContinuation,
  sameAuthor,
  type TimelineItem,
} from "./grouping"

const at = (month: number, day: number, hour: number, minute: number, second = 0, ms = 0) =>
  new Date(2024, month, day, hour, minute, second, ms).getTime()

const BASE = at(4, 13, 9, 30, 0, 0)
const BASE_DAY_START = at(4, 13, 0, 0)
const NEXT_DAY_START = at(4, 14, 0, 0)
const DAY_ONE_LAST_SECOND = at(4, 13, 23, 59, 59, 999)
const DAY_TWO_FIRST_MOMENT = at(4, 14, 0, 0, 0, 1)

const msg = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  threadId: "bot-atlas",
  sender: "user",
  body: id,
  sentAt: BASE,
  ...overrides,
})

const bot = (id: string, botId: string | undefined, sentAt = BASE): ChatMessage =>
  msg(id, sentAt === BASE ? { sender: "bot", botId } : { sender: "bot", botId, sentAt })

const dayStarts = (items: readonly TimelineItem[]): number[] =>
  items.flatMap((item) => (item.kind === "day-divider" ? [item.dayStart] : []))

const messageIds = (items: readonly TimelineItem[]): string[] =>
  items.flatMap((item) => (item.kind === "message" ? [item.message.id] : []))

const rowFor = (items: readonly TimelineItem[], id: string) => {
  const row = items.find((item) => item.kind === "message" && item.message.id === id)
  if (row?.kind !== "message") throw new Error(`no message row for ${id}`)
  return row
}

describe("sameAuthor", () => {
  test("a user message is authored by the viewer regardless of time", () => {
    expect(sameAuthor(msg("a"), msg("b", { sentAt: BASE + 5_000 }))).toBe(true)
  })

  test("a bot matches itself", () => {
    expect(sameAuthor(bot("a", "bot-atlas"), bot("b", "bot-atlas"))).toBe(true)
  })

  test("a bot does not match a different bot", () => {
    expect(sameAuthor(bot("a", "bot-atlas"), bot("b", "bot-halo"))).toBe(false)
  })

  test("two bot messages both missing botId are not the same person", () => {
    expect(sameAuthor(bot("a", undefined), bot("b", undefined))).toBe(false)
  })

  test("a user never matches a bot", () => {
    expect(sameAuthor(msg("a"), bot("b", "bot-atlas"))).toBe(false)
  })
})

describe("isContinuation", () => {
  test("same author inside the window continues", () => {
    expect(isContinuation(msg("a"), msg("b", { sentAt: BASE + 60_000 }))).toBe(true)
  })

  test("exactly on the window boundary continues", () => {
    expect(MESSAGE_GROUPING_WINDOW_MS).toBe(600_000)
    expect(isContinuation(msg("a"), msg("b", { sentAt: BASE + MESSAGE_GROUPING_WINDOW_MS }))).toBe(
      true,
    )
  })

  test("one millisecond past the window does not continue", () => {
    expect(isContinuation(msg("a"), msg("b", { sentAt: BASE + MESSAGE_GROUPING_WINDOW_MS + 1 }))).toBe(
      false,
    )
  })

  test("a message timestamped before its predecessor does not continue", () => {
    expect(isContinuation(msg("a", { sentAt: BASE }), msg("b", { sentAt: BASE - 1 }))).toBe(false)
  })

  test("a reply never continues the message before it", () => {
    const reply = msg("b", { sentAt: BASE + 1_000, replyToId: "a" })
    expect(isContinuation(msg("a"), reply)).toBe(false)
  })

  test("a message never continues into a reply, even at zero gap", () => {
    const reply = msg("a", { sentAt: BASE, replyToId: "z" })
    expect(isContinuation(reply, msg("b", { sentAt: BASE }))).toBe(false)
  })

  test("a different author does not continue", () => {
    expect(isContinuation(msg("a"), bot("b", "bot-atlas", BASE + 1_000))).toBe(false)
  })
})

describe("dayStartOf", () => {
  test("the last moment of a day and the first of the next are different days", () => {
    expect(dayStartOf(DAY_ONE_LAST_SECOND)).toBe(BASE_DAY_START)
    expect(dayStartOf(DAY_TWO_FIRST_MOMENT)).toBe(NEXT_DAY_START)
    expect(dayStartOf(DAY_TWO_FIRST_MOMENT)).not.toBe(dayStartOf(DAY_ONE_LAST_SECOND))
  })

  test("two moments on the same local day collapse to one day start", () => {
    expect(dayStartOf(at(4, 13, 0, 0, 0, 0))).toBe(BASE_DAY_START)
    expect(dayStartOf(at(4, 13, 12, 0, 0, 0))).toBe(BASE_DAY_START)
    expect(dayStartOf(DAY_ONE_LAST_SECOND)).toBe(BASE_DAY_START)
  })

  test("an afternoon timestamp resolves to local midnight, not a UTC day", () => {
    expect(dayStartOf(BASE)).toBe(BASE_DAY_START)
    expect(new Date(dayStartOf(BASE)).getHours()).toBe(0)
  })
})

describe("buildTimelineItems", () => {
  test("a single message still gets a day divider", () => {
    const items = buildTimelineItems([msg("a")])
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: "day-divider", key: `day-${BASE_DAY_START}`, dayStart: BASE_DAY_START })
    expect(rowFor(items, "a").isContinuation).toBe(false)
  })

  test("an empty conversation produces no rows", () => {
    expect(buildTimelineItems([])).toEqual([])
  })

  test("a day change inserts exactly one divider, not one per message", () => {
    const items = buildTimelineItems([
      msg("a", { sentAt: at(4, 12, 10, 0) }),
      msg("b", { sentAt: at(4, 12, 22, 0) }),
      msg("c", { sentAt: DAY_TWO_FIRST_MOMENT }),
      msg("d", { sentAt: at(4, 14, 18, 0) }),
    ])
    expect(dayStarts(items)).toEqual([at(4, 12, 0, 0), NEXT_DAY_START])
  })

  test("divider count equals the number of distinct local days", () => {
    const messages = [
      msg("a", { sentAt: at(4, 11, 8, 0) }),
      msg("b", { sentAt: at(4, 12, 8, 0) }),
      msg("c", { sentAt: at(4, 12, 9, 0) }),
      msg("d", { sentAt: at(4, 14, 8, 0) }),
    ]
    const items = buildTimelineItems(messages)
    const distinct = new Set(messages.map((message) => dayStartOf(message.sentAt)))
    expect(distinct.size).toBe(3)
    expect(dayStarts(items)).toHaveLength(distinct.size)
  })

  test("output length is messages plus dividers and every id appears once", () => {
    const messages = [
      msg("a", { sentAt: at(4, 12, 8, 0) }),
      msg("b", { sentAt: at(4, 12, 8, 1) }),
      msg("c", { sentAt: at(4, 13, 8, 0) }),
      msg("d", { sentAt: at(4, 13, 8, 1) }),
    ]
    const items = buildTimelineItems(messages)
    const dividers = dayStarts(items)
    expect(items).toHaveLength(messages.length + dividers.length)
    expect(messageIds(items)).toEqual(["a", "b", "c", "d"])
    expect(new Set(messageIds(items)).size).toBe(messages.length)
  })

  test("a run carries the sender's identity once at its top", () => {
    const items = buildTimelineItems([
      bot("a", "bot-atlas", BASE),
      bot("b", "bot-atlas", BASE + 1_000),
      bot("c", "bot-atlas", BASE + 2_000),
    ])
    expect(rowFor(items, "a").isContinuation).toBe(false)
    expect(rowFor(items, "b").isContinuation).toBe(true)
    expect(rowFor(items, "c").isContinuation).toBe(true)
  })

  test("isFollowedByContinuation is false on the last item", () => {
    const items = buildTimelineItems([
      msg("a", { sentAt: BASE }),
      msg("b", { sentAt: BASE + 1_000 }),
    ])
    expect(rowFor(items, "b").isFollowedByContinuation).toBe(false)
    expect(rowFor(items, "a").isFollowedByContinuation).toBe(true)
  })

  test("a single message is its own last item and is followed by nothing", () => {
    const items = buildTimelineItems([msg("a")])
    expect(rowFor(items, "a").isFollowedByContinuation).toBe(false)
  })

  test("a day divider between two same-author messages breaks the run", () => {
    const upper = msg("a", { sentAt: DAY_ONE_LAST_SECOND })
    const lower = msg("b", { sentAt: DAY_TWO_FIRST_MOMENT })
    expect(isContinuation(upper, lower)).toBe(true)
    const items = buildTimelineItems([upper, lower])
    expect(dayStarts(items)).toEqual([BASE_DAY_START, NEXT_DAY_START])
    expect(rowFor(items, "a").isFollowedByContinuation).toBe(false)
    expect(rowFor(items, "b").isContinuation).toBe(true)
  })

  test("a differing author is not reported as a followed continuation", () => {
    const items = buildTimelineItems([msg("a", { sentAt: BASE }), bot("b", "bot-atlas", BASE + 1_000)])
    expect(rowFor(items, "a").isFollowedByContinuation).toBe(false)
    expect(rowFor(items, "b").isContinuation).toBe(false)
  })

  test("a reply is never absorbed into the run above or below it", () => {
    const items = buildTimelineItems([
      msg("a", { sentAt: BASE }),
      msg("b", { sentAt: BASE + 1_000, replyToId: "z" }),
      msg("c", { sentAt: BASE + 2_000 }),
    ])
    expect(rowFor(items, "a").isFollowedByContinuation).toBe(false)
    expect(rowFor(items, "b").isContinuation).toBe(false)
    expect(rowFor(items, "b").isFollowedByContinuation).toBe(false)
    expect(rowFor(items, "c").isContinuation).toBe(false)
  })

  test("prepending older messages keeps the day keys the two lists share", () => {
    const shared = [
      msg("c", { sentAt: at(4, 13, 8, 0) }),
      msg("d", { sentAt: at(4, 13, 8, 1) }),
    ]
    const short = buildTimelineItems(shared)
    const long = buildTimelineItems([
      msg("a", { sentAt: at(4, 11, 8, 0) }),
      msg("b", { sentAt: at(4, 12, 8, 0) }),
      ...shared,
    ])
    expect(dayStarts(long).slice(-dayStarts(short).length)).toEqual(dayStarts(short))
    expect(long.map((item) => item.key).slice(-short.length)).toEqual(
      short.map((item) => item.key),
    )
  })

  test("the caller's array is neither reordered nor mutated", () => {
    const messages = [
      msg("a", { sentAt: at(4, 13, 8, 0) }),
      msg("b", { sentAt: at(4, 12, 8, 0) }),
    ]
    const snapshot = messages.map((message) => message.id)
    const items = buildTimelineItems(messages)
    expect(messages.map((message) => message.id)).toEqual(snapshot)
    expect(messageIds(items)).toEqual(snapshot)
    expect(items).not.toBe(messages)
  })
})

describe("firstUnreadIndex", () => {
  const items = buildTimelineItems([
    msg("a", { sentAt: at(4, 12, 8, 0) }),
    msg("b", { sentAt: at(4, 12, 8, 1) }),
    msg("c", { sentAt: at(4, 13, 8, 0) }),
  ])

  test("returns the item index, shifted by the dividers above the target", () => {
    expect(firstUnreadIndex(items, "a")).toBe(1)
    expect(firstUnreadIndex(items, "b")).toBe(2)
    expect(firstUnreadIndex(items, "c")).toBe(4)
  })

  test("returns -1 when the id is absent", () => {
    expect(firstUnreadIndex(items, "nope")).toBe(-1)
  })

  test("returns -1 for a null argument", () => {
    expect(firstUnreadIndex(items, null)).toBe(-1)
  })

  test("returns -1 for an empty timeline", () => {
    expect(firstUnreadIndex([], "a")).toBe(-1)
  })
})
