import { MAX_FRAME, MAX_MESSAGE_TEXT, sendFits } from "@kiko/protocol"
import type {
  AgentSlug,
  ClientToRoom,
  MemberOp,
  MemberRefusal,
  MessageId,
  RoomEvent,
  RunStep,
  RoomToClient,
  TaskOp,
  FileOp,
} from "@kiko/protocol"
import { ClientToRoom as ClientToRoomSchema } from "@kiko/protocol"
import { Schema } from "effect"
import type { RoomLog } from "./log"
import { parseRichText } from "@kiko/protocol/markdown"
import type { SearchOptions, SearchPage } from "./search"

export type Attachment = {
  ready: boolean
  helloBy?: number
}

export interface SocketRoom {
  readonly log: RoomLog
  mutateMessage?<T>(id: string, apply: () => T): Promise<T>
  publish(events: readonly RoomEvent[]): void
  humanTyping(): void
  presence(): RoomToClient[]
  stop(): void
  search(query: string, options?: SearchOptions): SearchPage | Promise<SearchPage>
  history?(seq: number, before: number, after: number): Promise<import("@kiko/protocol").Message[]>
  stepWindow(slug: AgentSlug, after: number): RunStep[]
  memberOp(op: MemberOp): MemberRefusal | null
  fileOp(op: FileOp): string | null
  humanSend(
    frame: Extract<ClientToRoom, { t: "send" }>,
  ): Promise<{ ack: { id: MessageId; seq: number }; events: RoomEvent[] } | { refused: string }>
  taskOp(op: TaskOp): string | null | void
  setModel(ref: string, slug?: AgentSlug): void
  answerAsk(id: string, value: string | import("@kiko/protocol").HumanAnswers): Promise<void>
  skipAsk(id: string): Promise<void>
  retryRun(messageId: MessageId): Promise<void>
}

const BAD_FRAME = 1008
const MAX_EMOJI = 32
const MAX_HISTORY = 100

const decode = Schema.decodeUnknownSync(ClientToRoomSchema)

const RETIRED = new Set(["catalog"])

function retired(raw: string | ArrayBuffer): boolean {
  if (typeof raw !== "string" || raw.length > MAX_FRAME) return false
  try {
    const t = (JSON.parse(raw) as { t?: unknown } | null)?.t
    return typeof t === "string" && RETIRED.has(t)
  } catch {
    return false
  }
}

function attachment(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { ready: false }
}

export function send(ws: WebSocket, frame: RoomToClient): void {
  try {
    ws.send(JSON.stringify(frame))
  } catch {}
}

function parse(raw: string | ArrayBuffer): ClientToRoom | null {
  if (typeof raw !== "string" || raw.length > MAX_FRAME) return null
  try {
    return decode(JSON.parse(raw))
  } catch {
    return null
  }
}

function refused(frame: ClientToRoom): string | null {
  switch (frame.t) {
    case "send": {
      const refs = frame.attachments ?? []
      if (frame.text.trim() === "" && refs.length === 0) return "that message is empty"
      return frame.text.length <= MAX_MESSAGE_TEXT && sendFits(frame.text, refs)
        ? null
        : "that message is too long to send"
    }
    case "edit":
      return frame.text.length <= MAX_MESSAGE_TEXT && sendFits(frame.text) && frame.text.trim() !== ""
        ? null
        : "that edit is too long to save"
    case "answer":
      return typeof frame.value === "string"
        ? frame.value.length <= MAX_MESSAGE_TEXT && sendFits(frame.value) && frame.value.trim() !== ""
          ? null
          : "that answer is too long to send"
        : sendFits("", [frame.value])
          ? null
          : "that answer is too long to send"
    case "react":
      return frame.emoji === null ||
        (frame.emoji.length > 0 && frame.emoji.length <= MAX_EMOJI && !/\s/.test(frame.emoji))
        ? null
        : "that reaction is not usable"
    case "member":
      return frame.op.op === "remove" || frame.op.name.trim() !== "" ? null : "that member needs a name"
    default:
      return null
  }
}

export async function handleFrame(room: SocketRoom, ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
  const frame = parse(raw)
  if (!frame) {
    if (!retired(raw)) ws.close(BAD_FRAME, "bad frame")
    return
  }
  const why = refused(frame)
  if (why) {
    send(ws, { t: "send_refused", clientId: "clientId" in frame ? frame.clientId : "", reason: why })
    return
  }
  const events = await apply(room, ws, frame)
  if (events) room.publish(Array.isArray(events) ? events : [events])
}

async function apply(
  room: SocketRoom,
  ws: WebSocket,
  frame: ClientToRoom,
): Promise<RoomEvent | readonly RoomEvent[] | null> {
  const { log } = room
  const human = { kind: "human" } as const
  switch (frame.t) {
    case "hello":
      send(ws, log.catchUp(frame.lastSeq))
      for (const f of room.presence()) send(ws, f)
      ws.serializeAttachment({ ...attachment(ws), ready: true } satisfies Attachment)
      return null
    case "send": {
      const out = await room.humanSend(frame)
      if ("refused" in out) {
        send(ws, { t: "send_refused", clientId: frame.clientId, reason: out.refused })
        return null
      }
      send(ws, { t: "ack", clientId: frame.clientId, ...out.ack })
      return out.events
    }
    case "edit":
      return room.mutateMessage
        ? room.mutateMessage(frame.messageId, () =>
            log.message(frame.messageId)?.from.kind === "human"
              ? log.editMessage(frame.messageId, frame.text, parseRichText(frame.text))
              : null,
          )
        : log.message(frame.messageId)?.from.kind === "human"
          ? log.editMessage(frame.messageId, frame.text, parseRichText(frame.text))
          : null
    case "delete":
      return room.mutateMessage
        ? room.mutateMessage(frame.messageId, () => log.deleteMessages([frame.messageId], human))
        : log.deleteMessages([frame.messageId], human)
    case "react":
      return room.mutateMessage
        ? room.mutateMessage(frame.messageId, () => log.react(frame.messageId, human, frame.emoji))
        : log.react(frame.messageId, human, frame.emoji)
    case "read":
      return log.markRead(frame.seq)
    case "typing":
      room.humanTyping()
      return null
    case "search": {
      const page = await room.search(frame.query.slice(0, 200), { before: frame.before, limit: frame.limit })
      send(ws, {
        t: "search",
        query: frame.query,
        ...(frame.before !== undefined ? { before: frame.before } : {}),
        ...page,
      })
      return null
    }
    case "history": {
      const before = Math.min(frame.before, MAX_HISTORY)
      const after = Math.min(frame.after, MAX_HISTORY)
      const messages = room.history
        ? await room.history(frame.seq, before, after)
        : log.around(frame.seq, before, after)
      send(ws, { t: "history", seq: frame.seq, before: frame.before, after: frame.after, messages })
      return null
    }
    case "steps":
      send(ws, { t: "steps", slug: frame.slug, after: frame.after, steps: room.stepWindow(frame.slug, frame.after) })
      return null
    case "stop":
      room.stop()
      return null
    case "model":
      room.setModel(frame.ref, frame.slug)
      return null
    case "answer":
      await room.answerAsk(frame.id, frame.value)
      return null
    case "skip":
      await room.skipAsk(frame.id)
      return null
    case "retry":
      await room.retryRun(frame.messageId)
      return null
    case "member": {
      const refused = room.memberOp(frame.op)
      if (refused) send(ws, { t: "member_refused", op: frame.op, reason: refused })
      return null
    }
    case "files": {
      const refused = room.fileOp(frame.op)
      if (refused) send(ws, { t: "files_refused", op: frame.op, reason: refused })
      return null
    }
    case "task": {
      const reason = room.taskOp(frame.op)
      if (reason) send(ws, { t: "task_refused", op: frame.op, reason })
      return null
    }
  }
}
