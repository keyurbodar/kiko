import type { Message, MessageId, RoomEvent, RoomId, RoomSnapshot, UserEvent, UserSnapshot } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Option from "effect/Option"
import { roomReducer } from "./room"
import {
  applyStreamItems,
  cachedStreamState,
  emptyStreamState,
  markDisconnected,
  markSynchronizing,
  type StreamItem,
} from "./stream"
import { userReducer } from "./user"

const ROOM = "01890000-0000-7000-8000-000000000001" as RoomId

const message = (seq: number, text: string): Message => ({
  id: `${seq}.room` as MessageId,
  seq,
  at: seq,
  from: { kind: "human" },
  text,
})

const roomSnapshot = (seq: number, messages: Message[]): RoomSnapshot => ({
  seq,
  readSeq: 0,
  members: [],
  messages,
  tasks: [],
  files: [],
  folders: [],
})

type RoomItem = StreamItem<RoomSnapshot, RoomEvent, never>

const messageEvent = (seq: number, text: string): RoomItem => ({
  kind: "event",
  sequence: seq,
  event: { t: "message", ...message(seq, text) },
})

const texts = (state: { data: Option.Option<RoomSnapshot> }) =>
  Option.getOrThrow(state.data).messages.map((m) => m.text)

describe("stream merge", () => {
  it("takes the snapshot cursor and skips events at or below it", () => {
    const state = applyStreamItems(
      markSynchronizing(emptyStreamState<RoomSnapshot>()),
      [
        { kind: "snapshot", snapshot: roomSnapshot(5, [message(4, "four"), message(5, "five")]) },
        messageEvent(5, "five again"),
        messageEvent(3, "late three"),
        messageEvent(6, "six"),
        messageEvent(6, "six again"),
        messageEvent(7, "seven"),
      ],
      roomReducer,
    )
    expect(state.sequence).toBe(7)
    expect(texts(state)).toEqual(["four", "five", "six", "seven"])
  })

  it("resumes from a cached cursor without duplicating replayed events", () => {
    const cached = cachedStreamState(roomSnapshot(6, [message(6, "six")]), 6)
    const resumed = applyStreamItems(
      markSynchronizing(cached),
      [messageEvent(5, "five"), messageEvent(6, "six"), messageEvent(7, "seven"), { kind: "synchronized" }],
      roomReducer,
    )
    expect(texts(resumed)).toEqual(["six", "seven"])
    expect(resumed.sequence).toBe(7)
    expect(resumed.status).toBe("live")
  })

  it("advances the cursor past event kinds this client does not know", () => {
    const start = cachedStreamState(roomSnapshot(1, []), 1)
    const unknown = { kind: "event", sequence: 2, event: { t: "hologram", seq: 2, at: 2 } } as unknown as RoomItem
    const next = applyStreamItems(start, [unknown, messageEvent(2, "dup"), messageEvent(3, "three")], roomReducer)
    expect(next.sequence).toBe(3)
    expect(texts(next)).toEqual(["three"])
  })

  it("marks data live only after the synchronized marker", () => {
    const syncing = applyStreamItems(
      markSynchronizing(emptyStreamState<RoomSnapshot>()),
      [{ kind: "snapshot", snapshot: roomSnapshot(1, []) }, messageEvent(2, "two")],
      roomReducer,
    )
    expect(syncing.status).toBe("synchronizing")
    const live = applyStreamItems(syncing, [{ kind: "synchronized" }], roomReducer)
    expect(live.status).toBe("live")
    expect(markDisconnected(live).status).toBe("cached")
    expect(markDisconnected(emptyStreamState()).status).toBe("empty")
  })

  it("applies chat projections at the cursor without advancing it", () => {
    const chat = (preview: string) => ({
      roomId: ROOM,
      title: "Chat",
      pinned: false,
      muted: false,
      lastSeq: 1,
      lastPreview: preview,
      unread: 0,
      updatedAt: 1,
    })
    const user: UserSnapshot = { seq: 4, chats: [chat("old")], home: { files: [], folders: [] } }
    const projection: UserEvent = { t: "chat", seq: 4, at: 9, chat: chat("new"), projection: true }
    const stale: UserEvent = { t: "chat", seq: 3, at: 9, chat: chat("stale"), projection: true }
    const next = applyStreamItems(
      cachedStreamState(user, 4),
      [
        { kind: "event", sequence: 4, event: projection },
        { kind: "event", sequence: 3, event: stale },
      ],
      userReducer,
    )
    expect(next.sequence).toBe(4)
    expect(Option.getOrThrow(next.data).chats[0]?.lastPreview).toBe("new")
  })
})
