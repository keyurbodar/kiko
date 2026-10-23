import {
  newRoomId,
  type Chat,
  type ChatOp,
  type CommandId,
  type Message,
  type MessageId,
  type PendingAttachment,
  type RoomId,
  type RoomSnapshot,
  type UserSnapshot,
} from "@kiko/protocol"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import type { OwnerSupervisor } from "../connection/supervisor"
import { currentSession, request, type RequestError } from "../rpc/client"
import { PendingCommands, roomKey } from "./pending"

export const newCommandId = (): CommandId => crypto.randomUUID() as CommandId

const PENDING_SEQUENCE = Number.MAX_SAFE_INTEGER

export interface SendMessageInput {
  readonly roomId: RoomId
  readonly text: string
  readonly replyTo?: MessageId
  readonly quote?: string
  readonly attachments?: ReadonlyArray<PendingAttachment>
  readonly commandId?: CommandId
}

export interface SentMessage {
  readonly commandId: CommandId
  readonly id: MessageId
  readonly seq: number
}

const optimisticMessage = (input: SendMessageInput, commandId: CommandId, at: number): Message => ({
  id: `local:${commandId}` as MessageId,
  clientId: commandId,
  seq: PENDING_SEQUENCE,
  at,
  from: { kind: "human" },
  text: input.text,
  ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
  ...(input.replyTo !== undefined && input.quote !== undefined ? { quote: input.quote } : {}),
})

const landed = (commandId: CommandId) => (room: RoomSnapshot) => room.messages.some((m) => m.clientId === commandId)

export const sendMessage = (
  input: SendMessageInput,
): Effect.Effect<SentMessage, RequestError<"room.send">, OwnerSupervisor | PendingCommands> =>
  Effect.gen(function* () {
    yield* currentSession
    const pending = yield* PendingCommands
    const commandId = input.commandId ?? newCommandId()
    const key = roomKey(input.roomId)
    const message = optimisticMessage(input, commandId, yield* Clock.currentTimeMillis)
    yield* pending.rooms.add(key, {
      commandId,
      apply: (room) => ({ ...room, messages: [...room.messages, message] }),
      settled: landed(commandId),
    })
    const ack = yield* request("room.send", {
      roomId: input.roomId,
      commandId,
      text: input.text,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      ...(input.quote === undefined ? {} : { quote: input.quote }),
      ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    }).pipe(Effect.onExit((exit) => (exit._tag === "Success" ? Effect.void : pending.rooms.remove(key, commandId))))
    yield* pending.rooms.confirm(key, commandId, ack.seq)
    return { commandId, id: ack.id, seq: ack.seq }
  })

const blankChat = (op: Extract<ChatOp, { op: "create" }>, at: number): Chat => ({
  roomId: op.roomId,
  title: op.title,
  pinned: false,
  muted: false,
  lastSeq: 0,
  lastPreview: "",
  unread: 0,
  updatedAt: at,
  ...(op.agents === undefined ? {} : { agents: op.agents }),
})

const patchChat = (snapshot: UserSnapshot, roomId: RoomId, patch: (chat: Chat) => Chat): UserSnapshot => ({
  ...snapshot,
  chats: snapshot.chats.map((chat) => (chat.roomId === roomId ? patch(chat) : chat)),
})

const findChat = (snapshot: UserSnapshot, roomId: RoomId) => snapshot.chats.find((chat) => chat.roomId === roomId)

function chatOverlay(op: ChatOp, at: number) {
  switch (op.op) {
    case "create":
      return {
        apply: (s: UserSnapshot) => (findChat(s, op.roomId) ? s : { ...s, chats: [...s.chats, blankChat(op, at)] }),
        settled: (s: UserSnapshot) => findChat(s, op.roomId) !== undefined,
      }
    case "delete":
      return {
        apply: (s: UserSnapshot) => ({ ...s, chats: s.chats.filter((chat) => chat.roomId !== op.roomId) }),
        settled: (s: UserSnapshot) => findChat(s, op.roomId) === undefined,
      }
    case "rename":
      return {
        apply: (s: UserSnapshot) => patchChat(s, op.roomId, (chat) => ({ ...chat, title: op.title })),
        settled: (s: UserSnapshot) => findChat(s, op.roomId)?.title === op.title,
      }
    case "pin":
      return {
        apply: (s: UserSnapshot) => patchChat(s, op.roomId, (chat) => ({ ...chat, pinned: op.pinned })),
        settled: (s: UserSnapshot) => findChat(s, op.roomId)?.pinned === op.pinned,
      }
    case "mute":
      return {
        apply: (s: UserSnapshot) => patchChat(s, op.roomId, (chat) => ({ ...chat, muted: op.muted })),
        settled: (s: UserSnapshot) => findChat(s, op.roomId)?.muted === op.muted,
      }
    case "private":
      return {
        apply: (s: UserSnapshot) => patchChat(s, op.roomId, (chat) => ({ ...chat, private: op.private })),
        settled: (s: UserSnapshot) => (findChat(s, op.roomId)?.private ?? false) === op.private,
      }
  }
}

export const chatCommand = (
  op: ChatOp,
  commandId: CommandId = newCommandId(),
): Effect.Effect<CommandId, RequestError<"chat.command">, OwnerSupervisor | PendingCommands> =>
  Effect.gen(function* () {
    yield* currentSession
    const pending = yield* PendingCommands
    yield* pending.user.add("user", { commandId, ...chatOverlay(op, yield* Clock.currentTimeMillis) })
    yield* request("chat.command", { commandId, op }).pipe(
      Effect.onExit((exit) => (exit._tag === "Success" ? Effect.void : pending.user.remove("user", commandId))),
    )
    yield* pending.user.confirm("user", commandId)
    return commandId
  })

export const createChat = (input: { readonly title: string; readonly agents?: ReadonlyArray<string> }) => {
  const roomId = newRoomId()
  return chatCommand({
    op: "create",
    roomId,
    title: input.title,
    ...(input.agents === undefined ? {} : { agents: input.agents }),
  }).pipe(Effect.as(roomId))
}
