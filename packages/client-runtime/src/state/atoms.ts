import type {
  AgentSlug,
  ChatOp,
  CommandId,
  Member,
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
import * as SchemaAST from "effect/SchemaAST"
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
import { SnapshotCache, type CachedSnapshot } from "../platform/cache"
import { chatCommand, createChat, newCommandId, sendMessage, type SendMessageInput } from "./commands"
import { createComputerAtoms } from "./computer"
import { withPending, type PendingCommand } from "./overlay"
import { PendingCommands, roomKey } from "./pending"
import {
  makeRoomState,
  newRoomState,
  resumedState,
  ROOM_SNAPSHOT_IDLE_TTL_MS,
  type RoomResumeCache,
  type RoomState,
} from "./roomState"
import type { OwnerRuntimeServices } from "./runtime"
import { cachedStreamState, emptyStreamState, type StreamState } from "./stream"
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

const payloadSchema = (tag: OwnerUnaryTag) =>
  OwnerRpcs.requests.get(tag)?.payloadSchema as (Schema.Top & { readonly fields?: Record<string, unknown> }) | undefined

const successSchema = <const Tag extends OwnerUnaryTag>(tag: Tag) =>
  OwnerRpcs.requests.get(tag)?.successSchema as unknown as Schema.Codec<OwnerRpcSuccess<Tag>, unknown>

const requestAny = request as unknown as (
  tag: OwnerUnaryTag,
  input: unknown,
) => Effect.Effect<unknown, unknown, OwnerSupervisor>

function sendRpc(tag: OwnerUnaryTag, input: object | undefined) {
  const schema = payloadSchema(tag)
  if (schema === undefined || SchemaAST.isVoid(schema.ast)) return requestAny(tag, undefined)
  return requestAny(tag, schema.fields?.commandId === undefined ? input : { commandId: newCommandId(), ...input })
}

const MEMORY_WRITES: ReadonlySet<MemoryOp["op"]> = new Set(["note", "pin", "redact", "set_model"])

const onceConnected = OwnerSupervisor.use((supervisor) =>
  SubscriptionRef.changes(supervisor.session).pipe(Stream.filter(Option.isSome), Stream.runHead),
)

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
      Stream.chunks,
      Stream.map(Option.some<ReadonlyArray<UserSignal>>),
    ),
    { initialValue: Option.none<ReadonlyArray<UserSignal>>() },
  )

  const roomResumeFamily = Atom.family((_roomId: RoomId) =>
    Atom.make((): RoomResumeCache => ({ snapshot: undefined, owner: undefined })).pipe(
      Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS),
    ),
  )
  const resumeIn = (resume: RoomResumeCache, current: Atom.Type<typeof runtime>) => {
    const services = Option.getOrUndefined(AsyncResult.value(current))
    if (resume.services === services) return resume
    resume.services = services
    resume.snapshot = undefined
    resume.owner = undefined
    return resume
  }
  const roomSignalsFamily = Atom.family((_roomId: RoomId) =>
    Atom.make(() => Effect.runSync(PubSub.unbounded<RoomSignal>())).pipe(Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS)),
  )

  const roomPagesFamily = Atom.family((_roomId: RoomId) =>
    Atom.make(() => Effect.runSync(PubSub.unbounded<ReadonlyArray<Message>>())).pipe(
      Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS),
    ),
  )

  const cachedRoomAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(
        SnapshotCache.use((cache) => cache.loadRoom(roomId)).pipe(
          Effect.orElseSucceed(() => Option.none<CachedSnapshot<RoomSnapshot>>()),
        ),
      )
      .pipe(Atom.setIdleTTL(ROOM_SNAPSHOT_IDLE_TTL_MS), Atom.withLabel(`kiko-room-cache:${roomId}`)),
  )

  const loadedCachedRoom = (registry: AtomRegistry.AtomRegistry, roomId: RoomId): RoomState | undefined => {
    const node = registry.getNodes().get(cachedRoomAtom(roomId)) as
      | AtomRegistry.Node<AsyncResult.AsyncResult<Option.Option<CachedSnapshot<RoomSnapshot>>>>
      | undefined
    const cached = node === undefined ? Option.none() : Option.flatMap(node.valueOption(), AsyncResult.value)
    if (Option.isNone(cached) || Option.isNone(cached.value)) return undefined
    return cachedStreamState(cached.value.value.snapshot, cached.value.value.sequence)
  }

  const roomStateAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(
        (get) => {
          const resumeAtom = roomResumeFamily(roomId)
          get.mount(resumeAtom)
          const resume = resumeIn(get.once(resumeAtom), get(runtime))
          const signals = get.once(roomSignalsFamily(roomId))
          const pages = get.once(roomPagesFamily(roomId))
          const loaded = resume.snapshot === undefined ? loadedCachedRoom(get.registry, roomId) : undefined
          const live = Stream.unwrap(
            makeRoomState(roomId, signals, { resume, pages, ...(loaded === undefined ? {} : { loaded }) }).pipe(
              Effect.map(SubscriptionRef.changes),
            ),
          )
          const first = resume.snapshot === undefined ? loaded : resumedState(resume.snapshot)
          return first === undefined ? live : Stream.concat(Stream.succeed(first), live)
        },
        { initialValue: EMPTY_ROOM },
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`kiko-room-state:${roomId}`)),
  )

  const seedNewRoom = (registry: AtomRegistry.AtomRegistry, roomId: RoomId, members: ReadonlyArray<Member>) => {
    const resume = resumeIn(registry.get(roomResumeFamily(roomId)), registry.get(runtime))
    if (resume.snapshot === undefined) resume.snapshot = newRoomState(members)
  }

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
      .atom(
        (get) =>
          Stream.fromPubSub(get(roomSignalsFamily(roomId))).pipe(
            Stream.chunks,
            Stream.map(Option.some<ReadonlyArray<RoomSignal>>),
          ),
        { initialValue: Option.none<ReadonlyArray<RoomSignal>>() },
      )
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
    ownerFiles: query({
      label: "files.all",
      execute: () => request("files.all", undefined),
      cached: successSchema("files.all"),
    }),
    recipes: query({
      label: "recipes.list",
      execute: () => request("recipes.list", undefined),
      cached: successSchema("recipes.list"),
      refreshOn: "recipes",
    }),
    soul: query({
      label: "soul.get",
      execute: (input: { readonly slug: AgentSlug }) => request("soul.get", input),
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
    roomThoughts: rpc("room.thoughts", {
      mode: "singleFlight",
      key: (input) => `${input.roomId}:${input.slug}:${input.runId}`,
    }),
    openChat: rpc("chat.open", { mode: "serial", key: () => "open" }),
    chatSearch: rpc("chat.search"),
    searchMessages: rpc("search.messages"),
    soulUpdate: effect("soul.update", Owner.updateSoul, { mode: "serial", key: (input) => input.slug }),
    memory: effect("memory.run", (input: { readonly op: MemoryOp }) =>
      MEMORY_WRITES.has(input.op.op)
        ? request("memory.run", input)
        : onceConnected.pipe(Effect.andThen(request("memory.run", input))),
    ),
    settingsGet: rpc("settings.get"),
    settingsUpdate: effect("settings.update", (input: RpcCommandInput<"settings.update">) =>
      queries.settings.edit(
        undefined,
        (settings) => ({ ...settings, ...input.patch }),
        sendRpc("settings.update", input) as Effect.Effect<
          OwnerRpcSuccess<"settings.update">,
          RequestError<"settings.update">,
          OwnerSupervisor
        >,
      ),
    ),
    fileToken: rpc("files.token", { mode: "singleFlight", key: () => "token" }),
    writeText: rpc("files.writeText", { mode: "serial", key: (input) => `${input.roomId}:${input.path}` }),
    credentialsList: rpc("credentials.list"),
    credentialsConnect: rpc("credentials.connect"),
    credentialsAddCustom: rpc("credentials.addCustom"),
    credentialsDisconnect: rpc("credentials.disconnect"),
    credentialsCheck: rpc("credentials.check"),
    loginStart: rpc("login.start"),
    loginAnswer: rpc("login.answer"),
    loginCancel: rpc("login.cancel"),
    composioConnect: rpc("composio.connect"),
    composioDisconnect: rpc("composio.disconnect"),
    kernelConnect: rpc("kernel.connect"),
    kernelDisconnect: rpc("kernel.disconnect"),
    webAppsStatus: effect(
      "webapps.status",
      () =>
        onceConnected.pipe(Effect.andThen(sendRpc("webapps.status", {}))) as Effect.Effect<
          OwnerRpcSuccess<"webapps.status">,
          RequestError<"webapps.status">,
          OwnerSupervisor
        >,
      { mode: "singleFlight", key: () => "webapps" },
    ),
    webAppsConnect: rpc("webapps.connect"),
    webAppsDisconnect: rpc("webapps.disconnect"),
    webAppsClaim: rpc("webapps.claim"),
    browserLink: rpc("browser.link"),
    browserHandBack: rpc("browser.handBack"),
    browserClose: rpc("browser.close"),
    pcPairCode: effect(
      "pc.pairCode",
      () =>
        onceConnected.pipe(Effect.andThen(sendRpc("pc.pairCode", undefined))) as Effect.Effect<
          OwnerRpcSuccess<"pc.pairCode">,
          RequestError<"pc.pairCode">,
          OwnerSupervisor
        >,
      { mode: "singleFlight", key: () => "pair" },
    ),
    pcList: rpc("pc.list"),
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
    routinesUpdate: effect("routines.update", Owner.updateRoutine),
    routinesCancel: effect("routines.cancel", Owner.cancelRoutine),
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
    seedNewRoom,
    sessionAtom,
    queries,
    commands,
  }
}
