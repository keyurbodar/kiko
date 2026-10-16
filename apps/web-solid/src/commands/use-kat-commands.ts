import { useLocation, useNavigate } from "@solidjs/router"
import { withMade } from "../files/api"
import { fileHits, listFiles } from "../files/go-to"
import { HOME } from "../files/model"
import { recentFiles } from "../files/recent"
import { closeChat, deleteChat, reopenClosedChat, sidebarOrder, startRename, togglePin } from "../sidebar/actions"
import { signOut } from "../app/session"
import { toggleCard } from "../chat/side/card-state"
import { fixedSurface, openFile, openSurface, toggleSidecar } from "../chat/side/surfaces"
import { answeringMember, canReason } from "../settings/agent-model"
import { THINKING_LABELS } from "@kiko/protocol"
import type { Choice } from "./registry"
import { openModelPicker } from "../settings/model-picker"
import { openPalette } from "../palette/state"
import { agentList } from "../lib/chats"
import { readCache } from "@kiko/theme/apply"
import { parseLook } from "@kiko/theme/look"
import { openSearch, requestJump } from "../search/state"
import { messageSearchCommand } from "./message-search"
import { katCommands } from "./kat-commands"
import { themeCommands } from "./theme-commands"
import { openAvatarPicker } from "../avatar/picker-state"
import { useApp } from "../lib/store"
import { openBotPicker, openNewAgentFlow } from "../chat/bot-picker-state"
import { navCommands } from "./nav-commands"
import { useCommands } from "./registry"

const CHAT_PATH = /^\/chat\/([^/]+)$/

/*
 * The router glue, kept apart from the table so the table tests without a
 * router. Call it once in the shell: kat's map registers for the shell's life.
 */
/** Register kat's map for the life of the calling component. Call it in the shell. */
export function useKatCommands(deps: { toggleSidebar: () => void }): void {
  const navigate = useNavigate()
  const location = useLocation()
  const activeId = () => {
    const id = CHAT_PATH.exec(location.pathname)?.[1]
    return id ? decodeURIComponent(id) : null
  }
  useCommands(
    katCommands({
      toggleSidebar: deps.toggleSidebar,
      // The one way to start a chat: pick the agent, or several for a group (chat/bot-picker.tsx).
      newChat: openBotPicker,
      openPalette: () => openPalette(),
      openChats: () => openPalette("chats.go"),
      openView: openPalette,
      chatChoices: () =>
        useApp.bots().map((chat) => ({ id: chat.id, title: chat.name, chatId: chat.id, run: () => navigate(`/chat/${chat.id}`) })),
      agentChoices: () =>
        agentList(useApp.agents()).map((agent) => ({
          id: agent.id,
          title: agent.name,
          seed: agent.slug,
          run: () => {
            const roomId = useApp.user()?.createChat(agent.name, [agent.id])
            if (roomId) navigate(`/chat/${roomId}`)
          },
        })),
      fileSearch: (query) => {
        const id = activeId()
        if (!id) return []
        const hits = fileHits(
          withMade(id, useApp.activeFiles()).map((f) => f.name),
          withMade(HOME, useApp.homeFiles()).map((f) => f.name),
        )
        return listFiles(hits, query, recentFiles(id)).map(({ hit, group }) => ({
          id: hit.path,
          title: hit.name,
          detail: hit.shown,
          file: hit.path,
          group,
          run: () => openFile(id, hit.path),
        }))
      },
      newGroup: openBotPicker,
      newAgent: openNewAgentFlow,
      toggleSidecar: () => {
        const id = activeId()
        if (id) toggleSidecar(id)
      },
      copyLink: () => {
        const id = activeId()
        if (id) void navigator.clipboard?.writeText(`${window.location.origin}/chat/${id}`)
      },
      hasActiveChat: () => activeId() !== null,
      toggleCard,
      openPanel: (kind) => {
        const id = activeId()
        if (id) openSurface(id, fixedSurface(kind))
      },
      closeChat: () => {
        const id = activeId()
        if (id) closeChat(id, id, navigate)
      },
      goToChat: (n) => {
        const row = sidebarOrder()[n - 1]
        if (row) navigate(`/chat/${row.id}`)
      },
      stepChat: (step) => {
        const order = sidebarOrder()
        const at = order.findIndex((r) => r.id === activeId())
        const row = order[at === -1 ? 0 : Math.max(0, Math.min(order.length - 1, at + step))]
        if (row && row.id !== activeId()) navigate(`/chat/${row.id}`)
      },
      chatCount: () => useApp.bots().length,
      searchChat: () => openSearch("chat"),
      reopenClosed: () => {
        const id = reopenClosedChat()
        if (id) navigate(`/chat/${id}`)
      },
      attach: () => document.querySelector<HTMLButtonElement>("[data-hint=\"chat.attach\"]")?.click(),
      rename: () => {
        const id = activeId()
        if (id) startRename(id)
      },
      canMove: () => {
        const id = activeId()
        return id !== null && !useApp.chat(id)?.kiko
      },
      togglePin: () => {
        const id = activeId()
        if (id && !useApp.chat(id)?.kiko) togglePin(id)
      },
      deleteChat: () => {
        const id = activeId()
        if (id && !useApp.chat(id)?.kiko) deleteChat(id, id, navigate)
      },
    }),
  )
  useCommands([
    messageSearchCommand({
      open: (hit) => {
        requestJump({ roomId: hit.roomId, id: hit.id, seq: hit.seq })
        if (hit.roomId !== activeId()) navigate(`/chat/${hit.roomId}`)
      },
      openView: openPalette,
    }),
  ])
  // The agent the composer's model chip targets when the draft tags no one: the lead.
  const chipAgent = () => answeringMember(useApp.roomMembers(), "")
  useCommands(
    navCommands({
      go: (href) => navigate(href),
      signOut: () => void signOut(),
      chooseModel: () => {
        // The picker lives in the chat top bar, so go there first when somewhere else.
        if (!location.pathname.startsWith("/chat")) navigate("/chat")
        openModelPicker()
      },
      openView: openPalette,
      canReason: () => canReason(useApp.agentModel(chipAgent()?.slug ?? "")?.thinkingLevels),
      reasoningChoices: () => {
        const agent = chipAgent()
        const picked = agent ? useApp.agentModel(agent.slug) : undefined
        if (!agent || !picked) return []
        return picked.thinkingLevels.map((level): Choice => ({ id: level, title: THINKING_LABELS[level], current: level === picked.thinking, run: () => useApp.setAgentModel(agent.slug, { thinking: level }) }))
      },
    }),
  )
  const live = () => import("../theme/live")
  useCommands(
    themeCommands({
      // The saved look is cached for the first paint, so the check mark reads it without loading the look.
      mode: () => parseLook(readCache()?.text ?? null).mode,
      accent: () => parseLook(readCache()?.text ?? null).accent,
      setMode: (mode) => void live().then((m) => m.updateLook({ mode })),
      setAccent: (accent) => void live().then((m) => m.updateLook({ accent })),
      openView: openPalette,
      activeAgent: () => {
        const id = activeId()
        const faces = id ? useApp.chatFaces(id) : []
        return faces.length === 1 ? faces[0]! : null
      },
      changeAvatar: openAvatarPicker,
    }),
  )
}
