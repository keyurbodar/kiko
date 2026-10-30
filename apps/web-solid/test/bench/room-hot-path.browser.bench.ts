import { type AgentSlug, type Message, type MessageId, newRoomId, type RoomId, type RoomSnapshot } from "@kiko/protocol"
import * as Option from "effect/Option"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/state/runtime", () => import("./fake-runtime"))
vi.mock("../../src/state/user", () => import("./fake-user"))
vi.mock("../../src/app/session", () => import("./fake-session"))

import type { RoomState } from "@kiko/client-runtime/state"
import { roomReducer } from "../../../../packages/client-runtime/src/state/room"
import { room } from "../../src/state/room"
import { owner, setAtomValue } from "./fake-runtime"

const ROOM: RoomId = newRoomId()
const RUNS = 3
const UPDATES = 200
const WITH_CHAT_VIEW = import.meta.env.VITE_BENCH_CHAT_VIEW === "1"

const SECTION_ORDER = [
  "reduce",
  "publish",
  "messages",
  "bots",
  "status",
  "typing",
  "mentions",
  "unread",
  "members",
  "lookup",
  "thoughts",
  "runs",
  "helpers",
  "chat-view-by-id",
] as const

type Section = (typeof SECTION_ORDER)[number]

let seq = 0

const base = 1_700_000_000_000

function build(count: number): RoomSnapshot {
  const messages: Message[] = []
  for (let i = 1; i < count; i += 1) {
    const id = `${i}.room` as MessageId
    const at = base + i
    if (i % 10 === 0)
      messages.push({
        id,
        seq: i,
        at,
        from: { kind: "human" },
        text: "",
        steps: 2,
        stepAfter: i - 1,
        event: { kind: "activity", agent: "kiko" as AgentSlug, private: true },
      })
    else if (i % 3 === 0)
      messages.push({ id, seq: i, at, from: { kind: "agent", slug: "kiko" as AgentSlug }, text: `reply ${i}` })
    else if (i % 5 === 0)
      messages.push({ id, seq: i, at, from: { kind: "agent", slug: "nova" as AgentSlug }, text: `hey @owner ${i}` })
    else messages.push({ id, seq: i, at, from: { kind: "human" }, text: `question ${i}` })
  }
  messages.push({
    id: "bench-last" as MessageId,
    seq: count,
    at: base + count,
    from: { kind: "agent", slug: "kiko" as AgentSlug },
    text: "",
  })
  return {
    seq: count,
    readSeq: Math.max(0, count - 20),
    members: [
      { slug: "kiko" as AgentSlug, name: "Kiko", lead: true },
      { slug: "nova" as AgentSlug, name: "Nova", lead: false },
    ],
    messages,
    tasks: [],
    files: [],
    folders: [],
    agents: [
      { slug: "kiko" as AgentSlug, state: "working" },
      { slug: "nova" as AgentSlug, state: "working" },
    ],
  }
}

function stateOf(snapshot: RoomSnapshot): RoomState {
  return {
    data: Option.some(snapshot),
    sequence: snapshot.seq,
    status: "live",
    error: Option.none(),
  }
}

function publish(snapshot: RoomSnapshot): void {
  setAtomValue(owner.roomAtom(ROOM), stateOf(snapshot))
}

function carryRun(count: number): void {
  seq = count
  publish(build(count))
  setAtomValue(owner.roomSignalAtom(ROOM), Option.some([{ t: "status", slug: "kiko", state: "working" }]))
  setAtomValue(
    owner.roomSignalAtom(ROOM),
    Option.some([
      {
        t: "step",
        step: {
          id: "step-1",
          runId: "run-1",
          slug: "kiko",
          tool: "run",
          name: "bash",
          label: "Ran tests",
          status: "running",
          startedAt: base + count,
          after: 0,
        },
      },
    ]),
  )
}

const times = new Map<Section, number>()

function section<T>(name: Section, read: () => T): T {
  const started = performance.now()
  const value = read()
  times.set(name, (times.get(name) ?? 0) + performance.now() - started)
  return value
}

function probe(): void {
  const rows = section("messages", () => room.messages())
  section("bots", () => room.bots())
  section("status", () => room.status())
  section("typing", () => {
    room.typingSlugs()
    room.typingDoings()
    room.typingNames()
  })
  section("mentions", () => room.unseenMentions())
  section("unread", () => {
    room.hasUnread()
    room.firstUnreadMessageId()
  })
  section("members", () => {
    room.members()
    room.roomMembers()
    room.chatById(ROOM)
  })
  const last = rows.at(-1)
  section("lookup", () => {
    if (last) room.messageById(last.id)
    room.thinking("kiko")
  })
  section("thoughts", () => {
    if (last) room.thoughtFor(last)
  })
  section("runs", () => {
    if (last) room.runWindow(last)
    const key = room.typingRun("kiko") ?? "kiko#0"
    room.runSteps(key)
    room.carriesRun("kiko")
    room.runEnd(key)
    if (room.carriesRun("kiko")) room.pendingWindows("kiko")
  })
  section("helpers", () => {
    room.helpers()
    room.nestedHelpers()
  })
  if (WITH_CHAT_VIEW) section("chat-view-by-id", () => new Map(rows.map((row) => [row.id, row])))
}

function measure(count: number): { total: number; sections: Record<string, number> } {
  seq = count
  let snapshot = build(count)
  publish(snapshot)
  times.clear()
  const start = snapshot.messages.at(-1)!
  let text = start.text
  const started = performance.now()
  for (let i = 0; i < UPDATES; i += 1) {
    text = `${text} token`
    const message = { ...start, text }
    snapshot = section("reduce", () => roomReducer.applyEvent(snapshot, { t: "message", ...message }, ++seq))
    section("publish", () => publish(snapshot))
    probe()
  }
  const total = performance.now() - started
  return { total, sections: Object.fromEntries(times) }
}

function median(values: readonly number[]): number {
  return [...values].toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!
}

function medianSections(runs: readonly Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const name of SECTION_ORDER) out[name] = median(runs.map((run) => run[name] ?? 0))
  return out
}

function reportFor(counts: readonly number[]) {
  return counts.map((count) => {
    const held = Array.from({ length: RUNS }, () => measure(count))
    return {
      messages: count,
      updates: UPDATES,
      medianMs: Number(median(held.map((run) => run.total)).toFixed(2)),
      runsMs: held.map((run) => Number(run.total.toFixed(2))),
      sectionsMs: Object.fromEntries(
        Object.entries(medianSections(held.map((run) => run.sections))).map(([name, value]) => [
          name,
          Number(value.toFixed(2)),
        ]),
      ),
    }
  })
}

describe("streaming hot path", () => {
  beforeEach(() => {
    room.followRoute(() => ROOM)
  })

  it("streams 200 updates into the last agent message and reports timings", () => {
    measure(300)
    const report = reportFor([300, 3000])
    console.log(`HOT_PATH_BENCH ${JSON.stringify(report)}`)
    expect(report).toHaveLength(2)
    expect(room.messages().length).toBeGreaterThan(0)
    expect(room.messages().at(-1)?.body).toContain("token")
  })

  it("measures the typing indicator while a run is carried", () => {
    carryRun(300)
    measure(300)
    carryRun(3000)
    const report = reportFor([3000])
    console.log(`HOT_PATH_PENDING_BENCH ${JSON.stringify(report)}`)
    expect(room.carriesRun("kiko")).toBe(true)
  })
})
