import { mentionsHuman, type AgentSlug, type Message, type MessageId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../lib/types"
import { stepWindows } from "../chat/run/run-log"
import { unfoldedRuns } from "../chat/lib/grouping"
import { MessageLedger, diffMessages } from "./message-ledger"

const PENDING_SEQ = Number.MAX_SAFE_INTEGER

let counter = 0

function message(over: Partial<Message> = {}): Message {
  counter += 1
  return {
    id: `${counter}.room` as MessageId,
    seq: counter,
    at: 1_000 + counter,
    from: { kind: "human" },
    text: `message ${counter}`,
    ...over,
  } as Message
}

const agent = (slug: string, over: Partial<Message> = {}): Message =>
  message({ from: { kind: "agent", slug: slug as AgentSlug }, ...over })

const human = (over: Partial<Message> = {}): Message => message({ from: { kind: "human" }, ...over })

const background = (slug: string, seq: number, steps = 2, stepAfter = 0): Message =>
  ({
    id: `${seq}.room` as MessageId,
    seq,
    at: 1_000 + seq,
    from: { kind: "human" },
    text: "",
    steps,
    stepAfter,
    event: { kind: "activity", agent: slug as AgentSlug, private: true },
  }) as Message

const isPending = (m: Message) => m.seq === PENDING_SEQ
const isEvent = (m: Message) => m.event !== undefined
const isListed = (m: Message) => m.to === undefined && !(m.event && "private" in m.event)

const refSent = (messages: readonly Message[]) =>
  messages
    .filter((m) => !isPending(m) && !isEvent(m))
    .map((m) => ({ seq: m.seq, from: m.from as { kind: string; slug?: string } }))

const refSaid = (messages: readonly Message[]) =>
  messages
    .filter((m) => !isPending(m))
    .map((m) => ({ id: m.id, seq: m.seq, at: m.at, agent: !isEvent(m) && m.from.kind !== "human" }))

const refNewestHuman = (messages: readonly Message[]) =>
  refSent(messages).findLast((m) => m.from.kind === "human")?.seq ?? 0

const refReplied = (messages: readonly Message[], slug: string, mark: number) =>
  refSent(messages).some((m) => m.seq > mark && m.from.kind === "agent" && m.from.slug === slug)

const refFirstReply = (messages: readonly Message[], slug: string, after: number) =>
  messages.find((m) => !isPending(m) && !isEvent(m) && m.from.kind === "agent" && m.from.slug === slug && m.seq > after)

const refMentions = (messages: readonly Message[], handle: string | null, slugs: readonly string[]) => {
  const own = handle && !slugs.includes(handle) ? handle : null
  const humans = new Set(messages.filter((m) => m.from.kind === "human").map((m) => m.id))
  return messages
    .filter(
      (m) =>
        !isPending(m) &&
        m.from.kind === "agent" &&
        m.to === undefined &&
        mentionsHuman(m.text, own, !!m.replyTo && humans.has(m.replyTo)),
    )
    .map((m) => ({ id: m.id, seq: m.seq }))
}

const refNewestListed = (messages: readonly Message[]) => messages.findLast(isListed)
const refNewestSeq = (messages: readonly Message[]) => messages.findLast((m) => !isPending(m))?.seq ?? 0

const windowRows = (messages: readonly Message[]) =>
  messages.flatMap((m) => {
    const botId =
      m.from.kind === "agent"
        ? m.from.slug
        : m.event?.kind === "activity" && "agent" in m.event
          ? m.event.agent
          : undefined
    return botId
      ? [
          {
            botId,
            ...(m.steps === undefined ? {} : { steps: m.steps }),
            ...(m.stepAfter === undefined ? {} : { stepAfter: m.stepAfter }),
          },
        ]
      : []
  })

const refWindows = (messages: readonly Message[]) => stepWindows(windowRows(messages))

const asRow = (m: Message): ChatMessage => {
  const botId =
    m.from.kind === "agent"
      ? m.from.slug
      : m.event?.kind === "activity" && "agent" in m.event
        ? m.event.agent
        : undefined
  return {
    id: m.id,
    threadId: "room",
    sender: m.from.kind === "human" ? "user" : "bot",
    ...(botId === undefined ? {} : { botId }),
    body: m.text,
    sentAt: m.at,
    seq: m.seq,
    ...(m.steps === undefined ? {} : { steps: m.steps }),
    ...(m.stepAfter === undefined ? {} : { stepAfter: m.stepAfter }),
    ...(m.to === undefined ? {} : { to: m.to }),
    ...(m.event === undefined ? {} : { event: m.event }),
    ...(m.goto === undefined ? {} : { goto: m.goto }),
  }
}

const refPending = (messages: readonly Message[], slug: string) =>
  unfoldedRuns(messages.map(asRow), slug).flatMap((m) =>
    m.steps ? [{ key: `${slug}#${m.stepAfter ?? 0}`, count: m.steps }] : [],
  )

function seed(): Message[] {
  const out: Message[] = []
  let seq = 0
  for (let i = 0; i < 40; i += 1) {
    seq += 1
    if (i % 7 === 0) out.push(background("kiko", seq))
    else if (i % 3 === 0)
      out.push(agent("kiko", { id: `${seq}.room` as MessageId, seq, at: 1_000 + seq, text: "reply" }))
    else if (i % 5 === 0)
      out.push(agent("nova", { id: `${seq}.room` as MessageId, seq, at: 1_000 + seq, text: "hey @owner" }))
    else out.push(human({ id: `${seq}.room` as MessageId, seq, at: 1_000 + seq, text: `human ${seq}` }))
  }
  return out
}

function expectLedgerMatches(ledger: MessageLedger, messages: readonly Message[], handle: string | null = "owner") {
  const slugs = ["kiko", "nova"]
  expect(ledger.sent()).toEqual(refSent(messages))
  expect(ledger.said()).toEqual(refSaid(messages))
  expect(ledger.newestHumanSeq()).toBe(refNewestHuman(messages))
  expect(ledger.newestSeq()).toBe(refNewestSeq(messages))
  expect(ledger.newestListed()?.id).toBe(refNewestListed(messages)?.id)
  expect(ledger.mentions(handle, slugs)).toEqual(refMentions(messages, handle, slugs))
  expect(ledger.windows()).toEqual(refWindows(messages))
  for (const slug of slugs) {
    expect(ledger.pendingWindows(slug)).toEqual(refPending(messages, slug))
    for (const mark of [0, 10, 39, 40, 1_000]) {
      expect(ledger.repliedSince(slug, mark)).toBe(refReplied(messages, slug, mark))
    }
    for (const after of [0, 5, 39, 40]) {
      expect(ledger.firstReplyAfter(slug, after)?.id).toBe(refFirstReply(messages, slug, after)?.id)
    }
  }
}

describe("diffMessages", () => {
  it("reports the appended tail when the list grows", () => {
    const before = seed()
    const after = [...before, human({ id: "99.room" as MessageId, seq: 99, at: 9_999 })]

    expect(diffMessages(before, after)).toEqual({ kind: "rebuild" })
    expect(diffMessages(before, before)).toEqual({ kind: "same" })
  })

  it("reports the changed positions when the list keeps its length", () => {
    const before = seed()
    const after = before.map((m, i) => (i === 3 ? { ...m, text: "edited" } : m))

    expect(diffMessages(before, after)).toEqual({ kind: "replace", changed: [3] })
  })

  it("leaves the ledger to rebuild a same-length reorder by identity", () => {
    const before = seed()
    const after = before.toReversed()

    expect(diffMessages(before, after).kind).toBe("replace")
  })
})

describe("MessageLedger", () => {
  it("matches a full recompute after an append", () => {
    const ledger = new MessageLedger()
    const before = seed()
    ledger.update(before)
    const after = [...before, human({ id: "99.room" as MessageId, seq: 99, at: 9_999 })]

    ledger.update(after)

    expectLedgerMatches(ledger, after)
  })

  it("matches a full recompute after a text edit in place", () => {
    const ledger = new MessageLedger()
    const before = seed()
    ledger.update(before)
    const after = before.map((m, i) => (i === 3 ? { ...m, text: "edited" } : m))

    ledger.update(after)

    expectLedgerMatches(ledger, after)
  })

  it("matches a full recompute after deleting a message", () => {
    const ledger = new MessageLedger()
    const before = seed()
    ledger.update(before)
    const after = before.filter((_, i) => i !== 6)

    ledger.update(after)

    expectLedgerMatches(ledger, after)
  })

  it("matches a full recompute after inserting a message in the middle", () => {
    const ledger = new MessageLedger()
    const before = seed()
    ledger.update(before)
    const after = [
      ...before.slice(0, 5),
      agent("nova", { id: "77.room" as MessageId, seq: 77, at: 7_777 }),
      ...before.slice(5),
    ]

    ledger.update(after)

    expectLedgerMatches(ledger, after)
  })

  it("matches a full recompute after reordering by seq", () => {
    const ledger = new MessageLedger()
    const before = seed()
    ledger.update(before)
    const after = before.toSorted((a, b) => b.seq - a.seq)

    ledger.update(after)

    expectLedgerMatches(ledger, after)
  })

  it("matches a full recompute for a rename that changes the mention handle", () => {
    const ledger = new MessageLedger()
    const messages = seed()
    ledger.update(messages)
    expect(ledger.mentions("owner", ["kiko", "nova"])).toEqual(refMentions(messages, "owner", ["kiko", "nova"]))
    expect(ledger.mentions("kiko", ["kiko", "nova"])).toEqual(refMentions(messages, "kiko", ["kiko", "nova"]))
    expect(ledger.mentions(null, ["kiko", "nova"])).toEqual(refMentions(messages, null, ["kiko", "nova"]))
  })

  it("drops a mention that came only from a reply once the human message is deleted", () => {
    const ledger = new MessageLedger()
    const asked = human({ id: "1.room" as MessageId, seq: 1, at: 1_001, text: "question" })
    const reply = agent("kiko", {
      id: "2.room" as MessageId,
      seq: 2,
      at: 1_002,
      text: "answer",
      replyTo: "1.room" as MessageId,
    })
    ledger.update([asked, reply])
    expect(ledger.mentions("owner", ["kiko"])).toEqual([{ id: "2.room", seq: 2 }])

    ledger.update([reply])

    expect(ledger.mentions("owner", ["kiko"])).toEqual([])
  })

  it("keeps the derived arrays identical while only the streamed text changes", () => {
    const ledger = new MessageLedger()
    const before = [...seed(), agent("kiko", { id: "60.room" as MessageId, seq: 60, at: 6_060, text: "" })]
    ledger.update(before)
    const sent = ledger.sent()
    const said = ledger.said()
    const windows = ledger.windows()
    const newest = ledger.newestListed()

    let streamed = before
    for (let i = 1; i <= 200; i += 1) {
      streamed = streamed.map((m) => (m.id === "60.room" ? { ...m, text: "token ".repeat(i) } : m))
      ledger.update(streamed)
    }

    expect(ledger.sent()).toBe(sent)
    expect(ledger.said()).toBe(said)
    expect(ledger.windows()).toBe(windows)
    expect(ledger.newestListed()).toBe(newest)
    expectLedgerMatches(ledger, streamed)
  })

  it("keeps the mention list identical when the streamed text still has no mention", () => {
    const ledger = new MessageLedger()
    const before = [...seed(), agent("kiko", { id: "61.room" as MessageId, seq: 61, at: 6_061, text: "" })]
    ledger.update(before)
    const mentions = ledger.mentions("owner", ["kiko", "nova"])

    const after = before.map((m) => (m.id === "61.room" ? { ...m, text: "still no handle" } : m))
    ledger.update(after)

    expect(ledger.mentions("owner", ["kiko", "nova"])).toBe(mentions)
  })

  it("adds a mention the moment the streamed text names the owner", () => {
    const ledger = new MessageLedger()
    const before = [...seed(), agent("kiko", { id: "62.room" as MessageId, seq: 62, at: 6_062, text: "hello " })]
    ledger.update(before)
    expect(ledger.mentions("owner", ["kiko", "nova"])).toEqual(refMentions(before, "owner", ["kiko", "nova"]))

    const after = before.map((m) => (m.id === "62.room" ? { ...m, text: "hello @owner" } : m))
    ledger.update(after)

    expect(ledger.mentions("owner", ["kiko", "nova"])).toEqual(refMentions(after, "owner", ["kiko", "nova"]))
  })

  it("treats a message sent straight to one agent as unmentioned", () => {
    const ledger = new MessageLedger()
    const messages = [
      human({ id: "1.room" as MessageId, seq: 1, at: 1_001 }),
      agent("kiko", { id: "2.room" as MessageId, seq: 2, at: 1_002, text: "@owner", to: "nova" as AgentSlug }),
    ]

    ledger.update(messages)

    expect(ledger.mentions("owner", ["kiko", "nova"])).toEqual([])
  })

  it("counts a pending message in neither the said nor the sent list", () => {
    const ledger = new MessageLedger()
    const messages = [...seed(), human({ id: "local:1" as MessageId, seq: PENDING_SEQ, at: 9_999 })]

    ledger.update(messages)

    expect(ledger.said()).toEqual(refSaid(messages))
    expect(ledger.sent()).toEqual(refSent(messages))
    expect(ledger.newestSeq()).toBe(refNewestSeq(messages))
  })

  it("reports the run windows still waiting for their agent", () => {
    const ledger = new MessageLedger()
    const base = [
      human({ id: "1.room" as MessageId, seq: 1, at: 1_001 }),
      background("kiko", 2, 2, 1),
      background("kiko", 3, 3, 2),
    ]
    ledger.update(base)
    const waiting = ledger.pendingWindows("kiko")

    expect(waiting).toEqual([
      { key: "kiko#1", count: 2 },
      { key: "kiko#2", count: 3 },
    ])
    expect(waiting).toEqual(refPending(base, "kiko"))

    const edited = base.map((m) => (m.id === ("2.room" as MessageId) ? { ...m, text: "edited" } : m))
    ledger.update(edited)
    expect(ledger.pendingWindows("kiko")).toBe(waiting)

    const replied = [...edited, agent("kiko", { id: "4.room" as MessageId, seq: 4, at: 1_004, steps: 1 })]
    ledger.update(replied)
    expect(ledger.pendingWindows("kiko")).toEqual([])
    expect(ledger.pendingWindows("kiko")).toEqual(refPending(replied, "kiko"))
  })

  it("keeps a step window for an activity message", () => {
    const ledger = new MessageLedger()
    const messages = [background("kiko", 1, 3, 0), background("kiko", 2, 2, 1)]

    ledger.update(messages)

    expect(ledger.windows()).toEqual(refWindows(messages))
    expect(ledger.windows()).toEqual(
      new Map([
        ["kiko#0", { key: "kiko#0", slug: "kiko", after: 0, steps: 3 }],
        ["kiko#1", { key: "kiko#1", slug: "kiko", after: 1, steps: 2 }],
      ]),
    )
    expect(ledger.windows().get("kiko#0")).toEqual({ key: "kiko#0", slug: "kiko", after: 0, steps: 3 })
  })
})
