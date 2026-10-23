import {
  RoomSignal,
  RoomToClient,
  UserSignal,
  UserToClient,
  type RoomStreamItem,
  type UserStreamItem,
} from "@kiko/protocol"
import * as Schema from "effect/Schema"
import { codecs, chunkFrame, type RequestId } from "./wire"

export type StreamKey = "user" | `room:${string}` | `pc:${string}`

export type Subscription = { readonly requestId: RequestId; readonly stream: StreamKey; cursor: number }

const USER_SIGNALS = new Set<string>(UserSignal.members.map((member) => member.fields.t.literal))
const ROOM_SIGNALS = new Set<string>(RoomSignal.members.map((member) => member.fields.t.literal))

const isUserSignal = (frame: UserToClient): frame is UserSignal => USER_SIGNALS.has(frame.t)
const isRoomSignal = (frame: RoomToClient): frame is RoomSignal => ROOM_SIGNALS.has(frame.t)

type Translated<T> = { readonly items: readonly T[]; readonly cursor: number }

const session = (frame: { version?: string; protocol?: number; fileToken?: string }) => ({
  ...(frame.version === undefined ? {} : { version: frame.version }),
  ...(frame.protocol === undefined ? {} : { protocol: frame.protocol }),
  ...(frame.fileToken === undefined ? {} : { fileToken: frame.fileToken }),
})

function userItems(frame: UserToClient, cursor: number): Translated<UserStreamItem> {
  if (frame.t === "reset")
    return { items: [{ kind: "snapshot", snapshot: frame.snapshot, ...session(frame) }], cursor: frame.snapshot.seq }
  if (frame.t === "events") {
    const items: UserStreamItem[] = []
    const extra = session(frame)
    if (Object.keys(extra).length) items.push({ kind: "session", ...extra })
    let at = cursor
    for (const event of frame.events) {
      const projection = event.t === "chat" && event.projection === true
      if (projection ? event.seq < at : event.seq <= at) continue
      if (!projection) at = event.seq
      items.push({ kind: "event", sequence: event.seq, event })
    }
    return { items, cursor: at }
  }
  return { items: isUserSignal(frame) ? [{ kind: "signal", signal: frame }] : [], cursor }
}

function roomItems(frame: RoomToClient, cursor: number): Translated<RoomStreamItem> {
  if (frame.t === "reset")
    return { items: [{ kind: "snapshot", snapshot: frame.snapshot }], cursor: frame.snapshot.seq }
  if (frame.t === "events") {
    const fresh = frame.events.filter((event) => event.seq > cursor)
    return {
      items: fresh.map((event) => ({ kind: "event", sequence: event.seq, event })),
      cursor: fresh.reduce((at, event) => Math.max(at, event.seq), cursor),
    }
  }
  return { items: isRoomSignal(frame) ? [{ kind: "signal", signal: frame }] : [], cursor }
}

const decodeUserFrame = Schema.decodeUnknownSync(Schema.toCodecJson(UserToClient))
const decodeRoomFrame = Schema.decodeUnknownSync(Schema.toCodecJson(RoomToClient))

const userCodecs = () => codecs("user.subscribe")!
const roomCodecs = () => codecs("room.subscribe")!

export function encodeItems(
  stream: StreamKey,
  requestId: RequestId,
  items: readonly (UserStreamItem | RoomStreamItem)[],
): string | null {
  const [first, ...rest] = items
  if (first === undefined) return null
  const encode = stream === "user" ? userCodecs().encodeChunk : roomCodecs().encodeChunk
  return chunkFrame(requestId, encode([first, ...rest]))
}

export function streamFrame(sub: Subscription, raw: string): { readonly text: string | null; readonly cursor: number } {
  try {
    const frame: unknown = JSON.parse(raw)
    const out =
      sub.stream === "user"
        ? userItems(decodeUserFrame(frame), sub.cursor)
        : roomItems(decodeRoomFrame(frame), sub.cursor)
    return { text: encodeItems(sub.stream, sub.requestId, out.items), cursor: out.cursor }
  } catch (e) {
    console.error(`rpc stream frame dropped: ${e instanceof Error ? e.message : String(e)}`)
    return { text: null, cursor: sub.cursor }
  }
}
