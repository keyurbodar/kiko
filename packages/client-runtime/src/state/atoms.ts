import type {
  AgentSlug,
  ChatOp,
  CommandId,
  MemoryOp,
  Message,
  RoomId,
  RoomSignal,
  RoomSnapshot,
  UserSignal,
  UserSnapshot,
} from "@kiko/protocol"
import { OwnerRpcs } from "@kiko/protocol/rpc"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { request, type RequestError } from "../rpc/client"
import type { OwnerRpcInput, OwnerRpcSuccess, OwnerUnaryTag } from "../rpc/protocol"
import { createRuntimeCommand, type AtomCommandConcurrency } from "./atomCommand"
import * as Owner from "./ownerCommands"
import { createQueryAtoms } from "./query"
import type { SupervisorConnectionState } from "../connection/model"
import { OwnerSupervisor } from "../connection/supervisor"
import { SnapshotCache } from "../platform/cache"
import { chatCommand, createChat, newCommandId, sendMessage, type SendMessageInput } from "./commands"
import { createComputerAtoms } from "./computer"
import { withPending, type PendingCommand } from "./overlay"
import { PendingCommands, roomKey } from "./pending"
import { makeRoomState, ROOM_SNAPSHOT_IDLE_TTL_MS, type RoomResumeCache, type RoomState } from "./roomState"
import type { OwnerRuntimeServices } from "./runtime"
import { emptyStreamState, markDisconnected, type StreamState } from "./stream"
import { UserStore, type UserState } from "./userState"

const AVAILABLE: SupervisorConnectionState = {
  desired: false,
  network: "unknown",
  phase: "available",
  stage: null,
  attempt: 0,
  generation: 0,
  lastFailure: null,
  retryAt: null,
}

const EMPTY_USER: UserState = { ...emptyStreamState<UserSnapshot>(), build: {} }
const EMPTY_ROOM: RoomState = emptyStreamState<RoomSnapshot>()

const valueOr = <A, E>(result: AsyncResult.AsyncResult<A, E>, fallback: A): A =>
  Option.getOrElse(AsyncResult.value(result), () => fallback)

export type RpcCommandInput<Tag extends OwnerUnaryTag> = Omit<OwnerRpcInput<Tag>, "commandId"> & {
  readonly commandId?: CommandId
}

const payloadFields = (tag: OwnerUnaryTag): Record<string, unknown> =>
  (OwnerRpcs.requests.get(tag)?.payloadSchema as { readonly fields?: Record<string, unknown> } | undefined)?.fields ??
  {}

const successSchema = <const Tag extends OwnerUnaryTag>(tag: Tag) =>
  OwnerRpcs.requests.get(tag)?.successSchema as unknown as Schema.Codec<OwnerRpcSuccess<Tag>, unknown>

const requestAny = request as unknown as (
  tag: OwnerUnaryTag,
  input: unknown,
) => Effect.Effect<unknown, unknown, OwnerSupervisor>

function sendRpc(tag: OwnerUnaryTag, input: object | undefined) {
  const fields = payloadFields(tag)
  if (Object.keys(fields).length === 0) return requestAny(tag, undefined)
  return requestAny(tag, fields.commandId === undefined ? input : { commandId: newCommandId(), ...input })
}

const EMPTY_TYPING: ReadonlyArray<AgentSlug> = []

function overlaid<S, T extends StreamState<S>>(state: T, pending: ReadonlyArray<PendingCommand<S>>): T {
  if (pending.length === 0 || Option.isNone(state.data)) return state
  return { ...state, data: Option.some(withPending(state.data.value, state.sequence, pending)) }
}

export function createOwnerAtoms<E>(runtime: Atom.AtomRuntime<OwnerRuntimeServices, E>) {
  const connectionAtom = runtime
    .atom(Stream.unwrap(OwnerSupervisor.useSync((supervisor) => SubscriptionRef.changes(supervisor.state))), {
      initialValue: AVAILABLE,
    })
    .pipe(Atom.keepAlive, Atom.withLabel("kiko-connection"))

  const userStateAtom = runtime
    .atom(Stream.unwrap(UserStore.useSync((user) => SubscriptionRef.changes(user.state))), { initialValue: EMPTY_USER })
    .pipe(Atom.keepAlive, Atom.withLabel("kiko-user-state"))

  const userPendingAtom = runtime
    .atom(Stream.unwrap(PendingCommands.useSync((pending) => pending.user.changes("user"))), { initialValue: [] })
    .pipe(Atom.keepAlive)

  const userAtom = Atom.make((get) =>
    overlaid<UserSnapshot, UserState>(valueOr(get(userStateAtom), EMPTY_USER), valueOr(get(userPendingAtom), [])),
  ).pipe(Atom.withLabel("kiko-user"))

  const userSignalAtom = runtime.atom(
    Stream.unwrap(UserStore.useSync((user) => Stream.fromPubSub(user.signals))).pipe(
      Stream.map(Option.some<UserSignal>),
    ),
    { initialValue: Option.none<UserSignal>() },
  )

  const roomResumeFamily = Atom.family((_roomId: RoomId) =>
    Atom.make((): RoomResumeCache => ({ snapshot: undefined, owner: undefined })).pipe(
      Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS),
    ),
  )
  const roomSignalsFamily = Atom.family((_roomId: RoomId) =>
    Atom.make(() => Effect.runSync(PubSub.unbounded<RoomSignal>())).pipe(Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS)),
  )

  const roomPagesFamily = Atom.family((_roomId: RoomId) =>
    Atom.make(() => Effect.runSync(PubSub.unbounded<ReadonlyArray<Message>>())).pipe(
      Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS),
    ),
  )

  const roomStateAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(
        (get) => {
          const resumeAtom = roomResumeFamily(roomId)
          get.mount(resumeAtom)
          const resume = get.once(resumeAtom)
          const signals = get.once(roomSignalsFamily(roomId))
          const pages = get.once(roomPagesFamily(roomId))
          const live = Stream.unwrap(
            makeRoomState(roomId, signals, resume, pages).pipe(Effect.map(SubscriptionRef.changes)),
          )
          return resume.snapshot === undefined
            ? live
            : Stream.concat(Stream.succeed(markDisconnected(resume.snapshot)), live)
        },
        { initialValue: EMPTY_ROOM },
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`kiko-room-state:${roomId}`)),
  )

  const roomPendingAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(Stream.unwrap(PendingCommands.useSync((pending) => pending.rooms.changes(roomKey(roomId)))), {
        initialValue: [],
      })
      .pipe(Atom.setIdleTTL(0)),
  )

  const roomAtom = Atom.family((roomId: RoomId) =>
    Atom.make((get) =>
      overlaid<RoomSnapshot, RoomState>(
        valueOr(get(roomStateAtom(roomId)), EMPTY_ROOM),
        valueOr(get(roomPendingAtom(roomId)), []),
      ),
    ).pipe(Atom.withLabel(`kiko-room:${roomId}`)),
  )

  const roomSignalAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom((get) => Stream.fromPubSub(get(roomSignalsFamily(roomId))).pipe(Stream.map(Option.some<RoomSignal>)), {
        initialValue: Option.none<RoomSignal>(),
      })
      .pipe(Atom.setIdleTTL(0)),
  )

  const roomTypingAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(
        (get) =>
          Stream.fromPubSub(get(roomSignalsFamily(roomId))).pipe(
            Stream.filter((signal) => signal.t === "typing"),
            Stream.map((signal): ReadonlyArray<AgentSlug> => signal.who),
          ),
        { initialValue: EMPTY_TYPING },
      )
      .pipe(Atom.setIdleTTL(0)),
  )

  const { sessionAtom, query } = createQueryAtoms(runtime)

  const { framesAtom } = createComputerAtoms(runtime)

  const cachedRoomAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(
        SnapshotCache.use((cache) => cache.loadRoom(roomId)).pipe(
          Effect.map(Option.map((cached) => cached.snapshot)),
          Effect.orElseSucceed(() => Option.none<RoomSnapshot>()),
        ),
      )
      .pipe(Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS), Atom.withLabel(`kiko-room-cache:${roomId}`)),
  )

  const rpc = <const Tag extends OwnerUnaryTag>(tag: Tag, concurrency?: AtomCommandConcurrency<RpcCommandInput<Tag>>) =>
    createRuntimeCommand(runtime, {
      label: tag,
      execute: (input: RpcCommandInput<Tag>) =>
        sendRpc(tag, input as object | undefined) as Effect.Effect<
          OwnerRpcSuccess<Tag>,
          RequestError<Tag>,
          OwnerSupervisor
        >,
      ...(concurrency === undefined ? {} : { concurrency }),
    })

  const effect = <W, A, E>(
    label: string,
    execute: (input: W) => Effect.Effect<A, E, OwnerRuntimeServices | AtomRegistry.AtomRegistry>,
    concurrency?: AtomCommandConcurrency<W>,
  ) => createRuntimeCommand(runtime, { label, execute, ...(concurrency === undefined ? {} : { concurrency }) })

  const queries = {
    settings: query({
      label: "settings.get",
      execute: () => request("settings.get", undefined),
      cached: successSchema("settings.get"),
    }),
    storageUsage: query({
      label: "storage.usage",
      execute: () => request("storage.usage", undefined),
      cached: successSchema("storage.usage"),
    }),
    modelsCatalog: query({
      label: "models.catalog",
      execute: () => request("models.catalog", undefined),
      refreshOn: "models",
      cached: successSchema("models.catalog"),
    }),
    version: query({
      label: "version.get",
      execute: () => request("version.get", undefined),
      cached: successSchema("version.get"),
    }),
    credentials: query({
      label: "credentials.list",
      execute: () => request("credentials.list", undefined),
      refreshOn: "models",
      cached: successSchema("credentials.list"),
    }),
    composio: query({
      label: "composio.status",
      execute: (input: { readonly tools?: boolean }) => request("composio.status", input),
      cached: successSchema("composio.status"),
    }),
    kernel: query({
      label: "kernel.status",
      execute: () => request("kernel.status", undefined),
      cached: successSchema("kernel.status"),
    }),
    recipes: query({
      label: "recipes.list",
      execute: () => request("recipes.list", undefined),
      cached: successSchema("recipes.list"),
    }),
    soul: query({
      label: "soul.get",
      execute: (input: { readonly slug: AgentSlug }) => request("soul.get", input),
      idleTtlMs: 60_000,
    }),
    memory: query({
      label: "memory.run",
      execute: (op: MemoryOp) => request("memory.run", { op }),
      refreshOn: "memory",
      idleTtlMs: 60_000,
    }),
  }

  const pageOf = (
    input: { readonly roomId: RoomId; readonly seq: number; readonly before: number; readonly after: number },
    publish: boolean,
  ) =>
    Effect.gen(function* () {
      const page = yield* request("room.history", input)
      if (publish && page.length > 0) {
        const registry = yield* AtomRegistry.AtomRegistry
        yield* PubSub.publish(registry.get(roomPagesFamily(input.roomId)), page)
      }
      return page
    })

  const commands = {
    sendMessage: effect("room.send", (input: SendMessageInput) => sendMessage(input)),
    chat: effect("chat.command", (input: { readonly op: ChatOp; readonly commandId?: CommandId }) =>
      chatCommand(input.op, input.commandId),
    ),
    createChat: effect("chat.create", (input: { readonly title: string; readonly agents?: ReadonlyArray<string> }) =>
      createChat(input),
    ),
    editMessage: effect("room.edit", Owner.editRoomMessage),
    deleteMessage: effect("room.delete", Owner.deleteRoomMessage),
    react: effect("room.react", Owner.reactToRoomMessage, {
      mode: "serial",
      key: (input) => `${input.roomId}:${input.messageId}`,
    }),
    markRead: effect("room.read", Owner.markRoomRead, { mode: "serial", key: (input) => input.roomId }),
    task: effect("room.task", Owner.roomTask),
    member: effect("room.member", Owner.roomMember),
    roomFiles: effect("room.files", Owner.roomFiles),
    answer: effect("room.answer", Owner.answerAsk, { mode: "singleFlight", key: (input) => input.askId }),
    skip: effect("room.skip", Owner.skipAsk, { mode: "singleFlight", key: (input) => input.askId }),
    homeFiles: effect("home.files", Owner.homeFiles),
    setTheme: effect("theme.set", Owner.setTheme, { mode: "serial", key: () => "theme" }),
    createAgent: effect("agent.create", Owner.createAgent),
    deleteAgent: effect("agent.command", Owner.deleteAgent),
    setAgentModel: effect("agent.setModel", Owner.setAgentModel, { mode: "serial", key: (input) => input.slug }),
    history: effect(
      "room.history",
      (input: {
        readonly roomId: RoomId
        readonly seq: number
        readonly before: number
        readonly after: number
        readonly merge: boolean
      }) => pageOf(input, input.merge),
    ),
    typing: rpc("room.typing"),
    stop: rpc("room.stop"),
    retry: rpc("room.retry"),
    setRoomModel: rpc("room.setModel"),
    roomSearch: rpc("room.search", { mode: "serial", key: (input) => input.roomId }),
    steps: rpc("room.steps", { mode: "singleFlight", key: (input) => `${input.roomId}:${input.slug}:${input.after}` }),
    openChat: rpc("chat.open", { mode: "serial", key: () => "open" }),
    chatSearch: rpc("chat.search"),
    searchMessages: rpc("search.messages"),
    soulUpdate: rpc("soul.update", { mode: "serial", key: (input) => input.slug }),
    memory: rpc("memory.run"),
    settingsGet: rpc("settings.get"),
    settingsUpdate: effect(
      "settings.update",
      (input: RpcCommandInput<"settings.update">) =>
        Effect.gen(function* () {
          const saved = (yield* sendRpc("settings.update", input)) as OwnerRpcSuccess<"settings.update">
          const registry = yield* AtomRegistry.AtomRegistry
          registry.refresh(queries.settings(undefined))
          return saved
        }) as Effect.Effect<
          OwnerRpcSuccess<"settings.update">,
          RequestError<"settings.update">,
          OwnerSupervisor | AtomRegistry.AtomRegistry
        >,
      { mode: "serial", key: () => "settings" },
    ),
    fileToken: rpc("files.token", { mode: "singleFlight", key: () => "token" }),
    writeText: rpc("files.writeText", { mode: "serial", key: (input) => `${input.roomId}:${input.path}` }),
    credentialsList: rpc("credentials.list"),
    credentialsConnect: rpc("credentials.connect"),
    credentialsDisconnect: rpc("credentials.disconnect"),
    credentialsCheck: rpc("credentials.check"),
    loginStart: rpc("login.start"),
    loginAnswer: rpc("login.answer"),
    loginCancel: rpc("login.cancel"),
    composioConnect: rpc("composio.connect"),
    composioDisconnect: rpc("composio.disconnect"),
    kernelConnect: rpc("kernel.connect"),
    kernelDisconnect: rpc("kernel.disconnect"),
    browserLink: rpc("browser.link"),
    browserHandBack: rpc("browser.handBack"),
    browserClose: rpc("browser.close"),
    pcPairCode: rpc("pc.pairCode", { mode: "singleFlight", key: () => "pair" }),
    pcRemove: rpc("pc.remove"),
    pcRename: rpc("pc.rename"),
    pcWatch: rpc("pc.watch"),
    pcTake: rpc("pc.take"),
    pcRelease: rpc("pc.release"),
    pcRtc: rpc("pc.rtc"),
    pcInput: rpc("pc.input"),
    pcAck: rpc("pc.ack"),
    recipesInstall: rpc("recipes.install"),
    recipesUninstall: rpc("recipes.uninstall"),
    recipesEdit: rpc("recipes.edit"),
    routinesUpdate: rpc("routines.update"),
    routinesCancel: rpc("routines.cancel"),
    updateStart: rpc("update.start", { mode: "singleFlight", key: () => "update" }),
  }

  const sendMessageAtom = runtime.fn((input: SendMessageInput) => sendMessage(input), { concurrent: true })
  const chatCommandAtom = runtime.fn(
    (input: { readonly op: ChatOp; readonly commandId?: CommandId }) => chatCommand(input.op, input.commandId),
    { concurrent: true },
  )
  const createChatAtom = runtime.fn(
    (input: { readonly title: string; readonly agents?: ReadonlyArray<string> }) => createChat(input),
    { concurrent: true },
  )
  const retryConnectionAtom = runtime.fn(() => OwnerSupervisor.use((supervisor) => supervisor.retryNow))

  return {
    connectionAtom,
    userAtom,
    userSignalAtom,
    roomAtom,
    roomSignalAtom,
    sendMessageAtom,
    chatCommandAtom,
    createChatAtom,
    retryConnectionAtom,
    roomTypingAtom,
    computerFramesAtom: framesAtom,
    cachedRoomAtom,
    sessionAtom,
    queries,
    commands,
  }
}
