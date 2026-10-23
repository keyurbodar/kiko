import type { ChatOp, CommandId, RoomId, RoomSignal, RoomSnapshot, UserSignal, UserSnapshot } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import type { SupervisorConnectionState } from "../connection/model"
import { OwnerSupervisor } from "../connection/supervisor"
import { chatCommand, createChat, sendMessage, type SendMessageInput } from "./commands"
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

  const roomStateAtom = Atom.family((roomId: RoomId) =>
    runtime
      .atom(
        (get) => {
          const resumeAtom = roomResumeFamily(roomId)
          get.mount(resumeAtom)
          const resume = get.once(resumeAtom)
          const signals = get.once(roomSignalsFamily(roomId))
          const live = Stream.unwrap(makeRoomState(roomId, signals, resume).pipe(Effect.map(SubscriptionRef.changes)))
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
  }
}
