import {
  humanAnswerText,
  type Agent,
  type AgentModel,
  type AgentSlug,
  type CommandId,
  type FileOp,
  type HumanAnswers,
  type MemberOp,
  type Message,
  type MessageId,
  type RoomId,
  type RoomSnapshot,
  type TaskOp,
  type ThinkingLevel,
  type UserSnapshot,
} from "@kiko/protocol"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import type { OwnerSupervisor } from "../connection/supervisor"
import { currentSession, request, type RequestError } from "../rpc/client"
import type { OwnerUnaryTag } from "../rpc/protocol"
import { newCommandId } from "./commands"
import { applyFileOp, applyFolderOp, applyMemberOp, applyTaskOp, editMessage, mapMessage, reactToMessage } from "./ops"
import { PendingCommands, roomKey, type PendingLane } from "./pending"

interface Overlay<S> {
  readonly apply: (snapshot: S) => S
  readonly settled?: (snapshot: S) => boolean
}

const withOverlay = <S, K extends string, A, E>(
  lane: (pending: PendingCommands["Service"]) => PendingLane<S, K>,
  key: K,
  overlay: Overlay<S>,
  send: (commandId: CommandId) => Effect.Effect<A, E, OwnerSupervisor>,
) =>
  Effect.gen(function* () {
    yield* currentSession
    const pending = lane(yield* PendingCommands)
    const commandId = newCommandId()
    yield* pending.add(key, { commandId, ...overlay })
    const result = yield* send(commandId).pipe(
      Effect.onExit((exit) => (exit._tag === "Success" ? Effect.void : pending.remove(key, commandId))),
    )
    yield* pending.confirmNext(key, commandId)
    return result
  })

const inRoom = <A, E>(
  roomId: RoomId,
  overlay: Overlay<RoomSnapshot>,
  send: (commandId: CommandId) => Effect.Effect<A, E, OwnerSupervisor>,
) => withOverlay((pending) => pending.rooms, roomKey(roomId), overlay, send)

const inUser = <A, E>(
  overlay: Overlay<UserSnapshot>,
  send: (commandId: CommandId) => Effect.Effect<A, E, OwnerSupervisor>,
) => withOverlay((pending) => pending.user, "user" as const, overlay, send)

type RoomEffect<Tag extends OwnerUnaryTag, A = void> = Effect.Effect<
  A,
  RequestError<Tag>,
  OwnerSupervisor | PendingCommands
>

const messageOf = (room: RoomSnapshot, id: MessageId) => room.messages.find((m) => m.id === id)

export const editRoomMessage = (input: {
  readonly roomId: RoomId
  readonly messageId: MessageId
  readonly text: string
}): RoomEffect<"room.edit"> =>
  Effect.flatMap(Clock.currentTimeMillis, (at) =>
    inRoom(
      input.roomId,
      {
        apply: (room) => ({
          ...room,
          messages: mapMessage(room.messages, input.messageId, (m) => editMessage(m, input.text, at)),
        }),
        settled: (room) => messageOf(room, input.messageId)?.text === input.text,
      },
      (commandId) => request("room.edit", { ...input, commandId }),
    ),
  )

export const deleteRoomMessage = (input: { readonly roomId: RoomId; readonly messageId: MessageId }) =>
  inRoom(
    input.roomId,
    {
      apply: (room) => ({ ...room, messages: mapMessage(room.messages, input.messageId, () => null) }),
      settled: (room) => messageOf(room, input.messageId) === undefined,
    },
    (commandId) => request("room.delete", { ...input, commandId }),
  ) satisfies RoomEffect<"room.delete">

const ownReaction = (message: Message | undefined) => message?.reactions?.find((r) => r.by.kind === "human")?.emoji

export const reactToRoomMessage = (input: {
  readonly roomId: RoomId
  readonly messageId: MessageId
  readonly emoji: string | null
}): RoomEffect<"room.react"> =>
  inRoom(
    input.roomId,
    {
      apply: (room) => ({
        ...room,
        messages: mapMessage(room.messages, input.messageId, (m) => reactToMessage(m, input.emoji)),
      }),
      settled: (room) => (ownReaction(messageOf(room, input.messageId)) ?? null) === input.emoji,
    },
    (commandId) => request("room.react", { ...input, commandId }),
  )

export const markRoomRead = (input: { readonly roomId: RoomId; readonly seq: number }): RoomEffect<"room.read"> =>
  inRoom(
    input.roomId,
    {
      apply: (room) => (room.readSeq >= input.seq ? room : { ...room, readSeq: input.seq }),
      settled: (room) => room.readSeq >= input.seq,
    },
    () => request("room.read", input),
  )

export const roomTask = (input: { readonly roomId: RoomId; readonly op: TaskOp }): RoomEffect<"room.task"> =>
  inRoom(input.roomId, { apply: (room) => ({ ...room, tasks: applyTaskOp(room.tasks, input.op) }) }, (commandId) =>
    request("room.task", { ...input, commandId }),
  )

export const roomMember = (input: {
  readonly roomId: RoomId
  readonly op: MemberOp
}): RoomEffect<"room.member", ReadonlyArray<RoomSnapshot["members"][number]>> =>
  inRoom(
    input.roomId,
    { apply: (room) => ({ ...room, members: applyMemberOp(room.members, input.op) }) },
    (commandId) => request("room.member", { ...input, commandId }),
  )

export const roomFiles = (input: { readonly roomId: RoomId; readonly op: FileOp }): RoomEffect<"room.files"> =>
  inRoom(
    input.roomId,
    {
      apply: (room) => ({
        ...room,
        files: applyFileOp(room.files, room.folders, input.op),
        folders: applyFolderOp(room.folders, input.op),
      }),
    },
    (commandId) => request("room.files", { ...input, commandId }),
  )

const PENDING_SEQUENCE = Number.MAX_SAFE_INTEGER

export const answerAsk = (input: {
  readonly roomId: RoomId
  readonly askId: string
  readonly value: string | HumanAnswers
}): RoomEffect<"room.answer"> =>
  Effect.flatMap(Clock.currentTimeMillis, (at) =>
    inRoom(
      input.roomId,
      {
        apply: (room) => {
          const ask = room.asks?.find((a) => a.id === input.askId)
          const text = ask ? humanAnswerText(ask, input.value) : null
          const asks = (room.asks ?? []).filter((a) => a.id !== input.askId)
          if (!ask || text === null) return { ...room, asks }
          const message: Message = {
            id: `local:answer:${input.askId}` as MessageId,
            clientId: `answer:${input.askId}`,
            seq: PENDING_SEQUENCE,
            at,
            from: { kind: "human" },
            text,
            replyTo: ask.messageId,
          }
          return { ...room, asks, messages: [...room.messages, message] }
        },
        settled: (room) => !(room.asks ?? []).some((a) => a.id === input.askId),
      },
      (commandId) => request("room.answer", { ...input, commandId }),
    ),
  )

export const skipAsk = (input: { readonly roomId: RoomId; readonly askId: string }): RoomEffect<"room.skip"> =>
  inRoom(
    input.roomId,
    {
      apply: (room) => ({ ...room, asks: (room.asks ?? []).filter((a) => a.id !== input.askId) }),
      settled: (room) => !(room.asks ?? []).some((a) => a.id === input.askId),
    },
    (commandId) => request("room.skip", { ...input, commandId }),
  )

type UserEffect<Tag extends OwnerUnaryTag, A = void> = Effect.Effect<
  A,
  RequestError<Tag>,
  OwnerSupervisor | PendingCommands
>

export const homeFiles = (op: FileOp): UserEffect<"home.files"> =>
  inUser(
    {
      apply: (user) => ({
        ...user,
        home: {
          files: applyFileOp(user.home.files, user.home.folders, op),
          folders: applyFolderOp(user.home.folders, op),
        },
      }),
    },
    (commandId) => request("home.files", { commandId, op }),
  )

export const setTheme = (theme: string | null): UserEffect<"theme.set"> =>
  inUser({ apply: (user) => ({ ...user, theme }), settled: (user) => user.theme === theme }, (commandId) =>
    request("theme.set", { commandId, theme }),
  )

export interface CreateAgentInput {
  readonly agent: Agent
  readonly roomId: RoomId
  readonly description: string
}

export const createAgent = (input: CreateAgentInput): UserEffect<"agent.create"> =>
  Effect.flatMap(Clock.currentTimeMillis, (at) =>
    inUser(
      {
        apply: (user) => ({
          ...user,
          agents: [...(user.agents ?? []).filter((a) => a.id !== input.agent.id), input.agent],
          chats: user.chats.some((c) => c.roomId === input.roomId)
            ? user.chats
            : [
                ...user.chats,
                {
                  roomId: input.roomId,
                  title: input.agent.name,
                  pinned: false,
                  muted: false,
                  lastSeq: 0,
                  lastPreview: "",
                  unread: 0,
                  updatedAt: at,
                  agents: [input.agent.id],
                },
              ],
        }),
        settled: (user) =>
          (user.agents ?? []).some((a) => a.id === input.agent.id) && user.chats.some((c) => c.roomId === input.roomId),
      },
      (commandId) =>
        request("agent.create", {
          commandId,
          id: input.agent.id,
          roomId: input.roomId,
          name: input.agent.name,
          handle: input.agent.slug,
          description: input.description,
        }),
    ),
  )

export const deleteAgent = (slug: AgentSlug): UserEffect<"agent.command"> =>
  inUser(
    {
      apply: (user) => ({ ...user, agents: (user.agents ?? []).filter((a) => a.slug !== slug) }),
      settled: (user) => !(user.agents ?? []).some((a) => a.slug === slug),
    },
    (commandId) => request("agent.command", { commandId, op: { op: "delete", slug } }),
  )

export interface SetAgentModelInput {
  readonly slug: AgentSlug
  readonly ref?: string
  readonly thinking?: ThinkingLevel
  readonly roomId?: RoomId
  readonly optimistic?: AgentModel
}

export const setAgentModel = (input: SetAgentModelInput): UserEffect<"agent.setModel"> => {
  const { optimistic, ...payload } = input
  return inUser(
    {
      apply: (user) =>
        optimistic === undefined ? user : { ...user, agentModels: { ...user.agentModels, [input.slug]: optimistic } },
      settled: (user) => {
        const current = user.agentModels?.[input.slug]
        return (
          current !== undefined &&
          (input.ref === undefined || current.model === input.ref) &&
          (input.thinking === undefined || current.thinking === input.thinking)
        )
      },
    },
    (commandId) => request("agent.setModel", { ...payload, commandId }),
  )
}
