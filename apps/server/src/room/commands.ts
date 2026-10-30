import {
  MAX_MESSAGE_TEXT,
  NotFoundError,
  RefusedError,
  sendFits,
  type AgentSlug,
  type FileOp,
  type HumanAnswers,
  type Member,
  type MemberOp,
  type MemberRefusal,
  type Message,
  type MessageId,
  type PendingAttachment,
  type RoomEvent,
  type RoomToClient,
  type RunStep,
  type TaskOp,
  type ThoughtPart,
} from "@kiko/protocol"
import { parseRichText } from "@kiko/protocol/markdown"
import * as Effect from "effect/Effect"
import type { RoomLog } from "./log"
import type { SearchOptions, SearchPage } from "./search"

export type Attachment = { ready: boolean }

export type SendInput = {
  readonly clientId: string
  readonly text: string
  readonly replyTo?: MessageId
  readonly quote?: string
  readonly attachments?: readonly PendingAttachment[]
}

export type SendOutcome = { ack: { id: MessageId; seq: number }; events: RoomEvent[] } | { refused: string }

export interface CommandRoom {
  readonly log: RoomLog
  gone(): boolean
  mutateMessage<T>(id: string, apply: () => T): Promise<T>
  publish(events: readonly RoomEvent[]): void
  humanTyping(): void
  stop(): Promise<void>
  search(query: string, options?: SearchOptions): SearchPage | Promise<SearchPage>
  history(seq: number, before: number, after: number): Promise<Message[]>
  stepWindow(slug: AgentSlug, after: number): RunStep[]
  thoughts(slug: AgentSlug, runId: string): Promise<ThoughtPart[]>
  memberOp(op: MemberOp): MemberRefusal | null
  memberList(): Member[]
  fileOp(op: FileOp): string | null
  humanSend(input: SendInput): Promise<SendOutcome>
  taskOp(op: TaskOp): string | null
  setModel(ref: string, slug?: AgentSlug): void
  answerAsk(id: string, value: string | HumanAnswers): Promise<void>
  skipAsk(id: string): Promise<void>
  retryRun(messageId: MessageId): Promise<void>
  settleHumanInput(): Promise<void>
}

const MAX_EMOJI = 32
const MAX_HISTORY = 100
const MAX_QUERY = 200

export function send(ws: WebSocket, frame: RoomToClient): void {
  try {
    ws.send(JSON.stringify(frame))
  } catch {}
}

export function sendRefusal(text: string, attachments: readonly PendingAttachment[] = []): string | null {
  if (text.trim() === "" && attachments.length === 0) return "that message is empty"
  return text.length <= MAX_MESSAGE_TEXT && sendFits(text, attachments) ? null : "that message is too long to send"
}

export function editRefusal(text: string): string | null {
  return text.length <= MAX_MESSAGE_TEXT && sendFits(text) && text.trim() !== ""
    ? null
    : "that edit is too long to save"
}

export function answerRefusal(value: string | HumanAnswers): string | null {
  const fits =
    typeof value === "string"
      ? value.length <= MAX_MESSAGE_TEXT && sendFits(value) && value.trim() !== ""
      : sendFits("", [value])
  return fits ? null : "that answer is too long to send"
}

export function reactionRefusal(emoji: string | null): string | null {
  return emoji === null || (emoji.length > 0 && emoji.length <= MAX_EMOJI && !/\s/.test(emoji))
    ? null
    : "that reaction is not usable"
}

export function memberRefusal(op: MemberOp): string | null {
  return op.op === "remove" || op.name.trim() !== "" ? null : "that member needs a name"
}

const refuse = (reason: string, message: string | null) =>
  message === null ? Effect.void : Effect.fail(new RefusedError({ reason, message }))

export function makeRoomCommands(room: CommandRoom) {
  const human = { kind: "human" } as const

  const open = Effect.suspend(() =>
    room.gone()
      ? Effect.fail(new NotFoundError({ resource: "room", message: "That chat does not exist." }))
      : Effect.void,
  )
  const settle = Effect.promise(() => room.settleHumanInput())
  const publish = (events: RoomEvent | readonly RoomEvent[] | null) =>
    Effect.sync(() => {
      if (events) room.publish(Array.isArray(events) ? events : [events])
    })
  const mutate = (messageId: MessageId, apply: () => RoomEvent | readonly RoomEvent[] | null) =>
    Effect.promise(() => room.mutateMessage(messageId, apply)).pipe(Effect.flatMap(publish))

  return {
    send: Effect.fn("Room.send")(function* (input: SendInput) {
      yield* open
      yield* refuse("send", sendRefusal(input.text, input.attachments))
      const out = yield* Effect.promise(() => room.humanSend(input))
      if ("refused" in out) return yield* new RefusedError({ reason: "send", message: out.refused })
      yield* publish(out.events)
      yield* settle
      return out.ack
    }),
    edit: Effect.fn("Room.edit")(function* (input: { readonly messageId: MessageId; readonly text: string }) {
      yield* open
      yield* refuse("edit", editRefusal(input.text))
      yield* mutate(input.messageId, () =>
        room.log.message(input.messageId)?.from.kind === "human"
          ? room.log.editMessage(input.messageId, input.text, parseRichText(input.text))
          : null,
      )
      yield* settle
    }),
    delete: Effect.fn("Room.delete")(function* (input: { readonly messageId: MessageId }) {
      yield* open
      yield* mutate(input.messageId, () => room.log.deleteMessages([input.messageId], human))
      yield* settle
    }),
    react: Effect.fn("Room.react")(function* (input: { readonly messageId: MessageId; readonly emoji: string | null }) {
      yield* open
      yield* refuse("react", reactionRefusal(input.emoji))
      yield* mutate(input.messageId, () => room.log.react(input.messageId, human, input.emoji))
      yield* settle
    }),
    read: Effect.fn("Room.read")(function* (input: { readonly seq: number }) {
      yield* open
      yield* publish(room.log.markRead(input.seq))
      yield* settle
    }),
    typing: Effect.fn("Room.typing")(function* () {
      yield* open
      room.humanTyping()
      yield* settle
    }),
    stop: Effect.fn("Room.stop")(function* () {
      yield* open
      yield* Effect.promise(() => room.stop())
      yield* settle
    }),
    setModel: Effect.fn("Room.setModel")(function* (input: { readonly ref: string; readonly slug?: AgentSlug }) {
      yield* open
      room.setModel(input.ref, input.slug)
      yield* settle
    }),
    task: Effect.fn("Room.task")(function* (input: { readonly op: TaskOp }) {
      yield* open
      yield* refuse("task", room.taskOp(input.op))
      yield* settle
    }),
    member: Effect.fn("Room.member")(function* (input: { readonly op: MemberOp }) {
      yield* open
      yield* refuse("member", memberRefusal(input.op))
      const refused = room.memberOp(input.op)
      if (refused) return yield* new RefusedError({ reason: refused, message: memberRefusalText(input.op, refused) })
      yield* settle
      return room.memberList()
    }),
    files: Effect.fn("Room.files")(function* (input: { readonly op: FileOp }) {
      yield* open
      yield* refuse("files", room.fileOp(input.op))
      yield* settle
    }),
    answer: Effect.fn("Room.answer")(function* (input: {
      readonly askId: string
      readonly value: string | HumanAnswers
    }) {
      yield* open
      yield* refuse("answer", answerRefusal(input.value))
      yield* Effect.promise(() => room.answerAsk(input.askId, input.value))
      yield* settle
    }),
    skip: Effect.fn("Room.skip")(function* (input: { readonly askId: string }) {
      yield* open
      yield* Effect.promise(() => room.skipAsk(input.askId))
      yield* settle
    }),
    retry: Effect.fn("Room.retry")(function* (input: { readonly messageId: MessageId }) {
      yield* open
      yield* Effect.promise(() => room.retryRun(input.messageId))
      yield* settle
    }),
    search: Effect.fn("Room.search")(function* (input: {
      readonly query: string
      readonly before?: number
      readonly limit?: number
    }) {
      yield* open
      return yield* Effect.promise(async () =>
        room.search(input.query.slice(0, MAX_QUERY), { before: input.before, limit: input.limit }),
      )
    }),
    history: Effect.fn("Room.history")(function* (input: {
      readonly seq: number
      readonly before: number
      readonly after: number
    }) {
      yield* open
      return yield* Effect.promise(() =>
        room.history(input.seq, Math.min(input.before, MAX_HISTORY), Math.min(input.after, MAX_HISTORY)),
      )
    }),
    steps: Effect.fn("Room.steps")(function* (input: { readonly slug: AgentSlug; readonly after: number }) {
      yield* open
      return room.stepWindow(input.slug, input.after)
    }),
    thoughts: Effect.fn("Room.thoughts")(function* (input: { readonly slug: AgentSlug; readonly runId: string }) {
      yield* open
      return yield* Effect.promise(() => room.thoughts(input.slug, input.runId))
    }),
  }
}

export type RoomCommands = ReturnType<typeof makeRoomCommands>

export function memberRefusalText(op: MemberOp, reason: MemberRefusal): string {
  const who = "name" in op ? op.name : op.slug
  switch (reason) {
    case "limit":
      return "A group holds at most 8 agents"
    case "exists":
      return `${who} is already in this chat`
    case "unknown":
      return `${who} is not in this chat`
    case "last":
      return "A chat keeps at least one agent"
    case "reserved":
      return `@${op.slug} is a reserved handle`
    case "chief":
      return "Kiko leads every chat and stays in it"
    case "kiko":
      return "The Kiko chat stays with Kiko. Start a new group instead"
  }
}
