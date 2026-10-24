import {
  clampThinking,
  defaultThinking,
  KIKO,
  newRoomId,
  sameAgentChat,
  type Agent,
  type AgentModel,
  type AgentSlug,
  type Chat,
  type ChatOp,
  type FileOp,
  type FileRef,
  type RoomId,
  type RowKind,
  type ThinkingLevel,
  type UserRows,
  type UserSignal,
} from "@kiko/protocol"
import { DuplicateChatError } from "@kiko/protocol/rpc"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import { createComputed, createMemo, createRoot, createSignal, untrack } from "solid-js"
import { kikoPlaceholder, newChatMembers } from "../lib/chats"
import { showFailure, showNotice } from "../lib/errors"
import { setFileToken, setFileTokenSource } from "../lib/file-token"
import { attempt, failureMessage, owner, registry, run, valueOf, watch } from "./runtime"
import { createUserSignals } from "./user-signals"

const chatOrder = (a: Chat, b: Chat) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt

const OPEN_DEBOUNCE_MS = 2_000

const signals = createUserSignals()
export const onUserSignal = signals.on
const deliver = signals.deliver

setFileTokenSource(async () => (await attempt(owner.commands.fileToken, {}, () => {}))?.fileToken)

export const user = createRoot(() => {
  const state = watch(() => owner.userAtom)
  const [typing, setTyping] = createSignal<Record<string, readonly string[]>>({})
  const [everLive, setEverLive] = createSignal(false)

  const onSignal = (value: UserSignal) =>
    untrack(() => {
      if (value.t === "typing")
        setTyping((all) => {
          const { [value.roomId]: _, ...rest } = all
          return value.names.length ? { ...rest, [value.roomId]: [...value.names] } : rest
        })
      deliver(value)
    })
  registry.subscribe(
    owner.userSignalAtom,
    (next) => {
      const burst = valueOf(next)
      if (burst !== undefined && Option.isSome(burst)) for (const signal of burst.value) onSignal(signal)
    },
    { immediate: true },
  )

  const snapshot = createMemo(() => Option.getOrUndefined(state().data))
  const status = () => state().status
  createComputed(() => {
    if (status() === "live") setEverLive(true)
    if (status() !== "live" && status() !== "synchronizing") setTyping({})
  })
  createComputed(() => {
    const token = state().build.fileToken
    if (token) untrack(() => setFileToken(token))
  })

  const loaded = () => status() !== "empty"
  const synced = () => everLive() || status() === "live"
  const placeholder = kikoPlaceholder(Date.now())
  const chats = createMemo(() => {
    const list = snapshot()?.chats ?? []
    return (list.length || synced() ? [...list] : [placeholder]).sort(chatOrder)
  })
  const agents = createMemo(() => [...(snapshot()?.agents ?? [])])
  const providers = () => (snapshot()?.rows?.provider ?? []) as readonly { id: string }[]

  const rows = <K extends RowKind>(kind: K): UserRows[K][] => (snapshot()?.rows?.[kind] ?? []) as UserRows[K][]

  function agentModel(slug: string): AgentModel | undefined {
    const pick = snapshot()?.agentModels?.[slug]
    if (!pick || !synced()) return pick
    const provider = pick.model.split("/")[0] ?? ""
    return !provider || providers().some((p) => p.id === provider) ? pick : undefined
  }

  function setAgentModel(
    slug: AgentSlug,
    pick: { ref?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[]; roomId?: RoomId },
  ) {
    const current = snapshot()?.agentModels?.[slug]
    const levels = pick.levels ?? current?.thinkingLevels
    const model = pick.ref ?? current?.model
    const optimistic: AgentModel | undefined =
      model && levels
        ? {
            model,
            thinking: clampThinking(levels, pick.thinking ?? current?.thinking ?? defaultThinking(levels)),
            thinkingLevels: [...levels],
          }
        : undefined
    void attempt(
      owner.commands.setAgentModel,
      {
        slug,
        ...(pick.ref ? { ref: pick.ref } : {}),
        ...(pick.thinking ? { thinking: pick.thinking } : {}),
        ...(pick.roomId ? { roomId: pick.roomId } : {}),
        ...(optimistic ? { optimistic } : {}),
      },
      (message) => showNotice({ message, action: "open_models" }),
      "Kiko could not change the model.",
    )
  }

  const [refused, setRefused] = createSignal<Record<string, RoomId>>({})
  async function chatOp(op: ChatOp) {
    const result = await run(owner.commands.chat, { op })
    if (result._tag === "Success" || Cause.hasInterruptsOnly(result.cause)) return
    const error = Cause.squash(result.cause)
    if (error instanceof DuplicateChatError)
      return void setRefused((all) => ({ ...all, [error.roomId]: error.existing }))
    showFailure(failureMessage(result.cause, "Kiko could not change that chat."))
  }

  function createChat(title: string, withAgents?: readonly string[]): RoomId {
    const existing = withAgents?.length ? sameAgentChat(chats(), withAgents) : null
    if (existing) return existing.roomId
    const roomId = newRoomId()
    owner.seedNewRoom(registry, roomId, newChatMembers(withAgents, agents()))
    void chatOp({ op: "create", roomId, title, ...(withAgents?.length ? { agents: [...withAgents] } : {}) })
    return roomId
  }

  let opening: ReturnType<typeof setTimeout> | undefined
  function open(roomId: RoomId) {
    clearTimeout(opening)
    opening = setTimeout(() => void attempt(owner.commands.openChat, { roomId }, () => {}), OPEN_DEBOUNCE_MS)
  }

  const homeRefusals = new Set<(op: FileOp, reason: string) => void>()
  async function homeOp(op: FileOp) {
    await attempt(owner.commands.homeFiles, op, (reason) => {
      for (const listener of homeRefusals) listener(op, reason)
    })
  }

  return {
    state,
    loaded,
    synced,
    status,
    snapshot,
    chats,
    agents,
    rows,
    agentModel,
    setAgentModel,
    createChat,
    open,
    rename: (roomId: RoomId, title: string) => void chatOp({ op: "rename", roomId, title }),
    pin: (roomId: RoomId, pinned: boolean) => void chatOp({ op: "pin", roomId, pinned }),
    mute: (roomId: RoomId, muted: boolean) => void chatOp({ op: "mute", roomId, muted }),
    setPrivate: (roomId: RoomId, value: boolean) => void chatOp({ op: "private", roomId, private: value }),
    remove: (roomId: RoomId) => void chatOp({ op: "delete", roomId }),
    togglePinned(roomId: string) {
      const c = chats().find((chat) => chat.roomId === roomId)
      if (c && !c.kiko) void chatOp({ op: "pin", roomId: c.roomId, pinned: !c.pinned })
    },
    refused: (roomId: string): RoomId | undefined => refused()[roomId],
    chat: (roomId: string | null) => (roomId === null ? undefined : chats().find((c) => c.roomId === roomId)),
    kikoChatId: () => chats().find((c) => c.kiko)?.roomId,
    lastChat: () => snapshot()?.lastChat ?? null,
    theme: () => snapshot()?.theme,
    build: () => state().build,
    homeFiles: (): FileRef[] => [...(snapshot()?.home.files ?? [])],
    homeFolders: (): string[] => [...(snapshot()?.home.folders ?? [])],
    homeOp: (op: FileOp) => void homeOp(op),
    onHomeRefused(listener: (op: FileOp, reason: string) => void): () => void {
      homeRefusals.add(listener)
      return () => homeRefusals.delete(listener)
    },
    typing: (roomId: string) => typing()[roomId],
    typingByRoom: typing,
    isGone: (slug: string) => synced() && slug !== KIKO && !agents().some((a: Agent) => a.slug === slug),
    modelsSynced: () => synced() || Object.keys(snapshot()?.agentModels ?? {}).length > 0,
    modelAgents: (): { slug: AgentSlug; name: string }[] => {
      const mine = agents().map((a) => ({ slug: a.slug, name: a.name }))
      return [{ slug: KIKO as AgentSlug, name: "Kiko" }, ...mine.filter((a) => a.slug !== KIKO)]
    },
  }
})
