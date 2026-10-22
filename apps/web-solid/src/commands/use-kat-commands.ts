import { createSignal, onCleanup } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { withMade } from "../files/api"
import { askDeleteChat, closeChat, reopenClosedChat, sidebarOrder, startRename, togglePin } from "../sidebar/actions"
import { signOut } from "../app/session"
import { toggleCard } from "../chat/side/card-state"
import { fixedSurface, openFile, openSurface, toggleSidecar } from "../chat/side/surfaces"
import { answeringMember, canReason } from "../settings/agent-model"
import { connectedProviders } from "../settings/connected"
import { hasModelProvider } from "../settings/provider-kinds"
import { THINKING_LABELS } from "@kiko/protocol"
import type { Choice } from "./registry"
import { openModelPicker } from "../settings/model-picker"
import { openPalette } from "../palette/state"
import { agentList } from "../lib/chats"
import { previewLook, readCache, subscribeCache } from "@kiko/theme/apply"
import { parseLook } from "@kiko/theme/look"
import { openSearch, requestJump } from "../search/state"
import { messageSearchCommand } from "./message-search"
import { katCommands } from "./kat-commands"
import { themeCommands } from "./theme-commands"
import { openAvatarPicker } from "../avatar/picker-state"
import { useApp } from "../lib/store"
import { openBotPicker } from "../chat/bot-picker-state"
import { openNewAgent } from "../newagent/state"
import { navCommands } from "./nav-commands"
import { useCommands } from "./registry"
import { browserCommands, startBrowser } from "../chat/browser"
import { isMac } from "../lib/platform"

const [goTo, setGoTo] = createSignal<typeof import("../files/go-to") & { HOME: string; recentFiles: typeof import("../files/recent").recentFiles }>()
const loadGoTo = () =>
  void Promise.all([import("../files/go-to"), import("../files/model"), import("../files/recent")]).then(([g, m, r]) => setGoTo(() => ({ ...g, HOME: m.HOME, recentFiles: r.recentFiles })))

const CHAT_PATH = /^\/chat\/([^/]+)$/

export function useKatCommands(deps: { toggleSidebar: () => void }): void {
  startBrowser()
  useCommands(browserCommands())
  const navigate = useNavigate()
  const location = useLocation()
  const activeId = () => {
    const id = CHAT_PATH.exec(location.pathname)?.[1]
    return id ? decodeURIComponent(id) : null
  }
  useCommands(
    katCommands({
      mac: isMac,
      toggleSidebar: deps.toggleSidebar,
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
        const mod = goTo()
        if (!id) return []
        if (!mod) {
          loadGoTo()
          return []
        }
        const hits = mod.fileHits(
          withMade(id, useApp.activeFiles()).map((f) => f.name),
          withMade(mod.HOME, useApp.homeFiles()).map((f) => f.name),
        )
        return mod.listFiles(hits, query, mod.recentFiles(id)).map(({ hit, group }) => ({
          id: hit.path,
          title: hit.name,
          detail: hit.shown,
          file: hit.path,
          group,
          run: () => openFile(id, hit.path),
        }))
      },
      newGroup: openBotPicker,
      newAgent: openNewAgent,
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
        if (id && !useApp.chat(id)?.kiko) askDeleteChat(id)
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
  const chipAgent = () => answeringMember(useApp.roomMembers(), "")
  useCommands(
    navCommands({
      go: (href) => navigate(href),
      signOut: () => void signOut(),
      chooseModel: () => {
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
      canChooseModel: () => hasModelProvider(connectedProviders()),
    }),
  )
  const live = () => import("../theme/live")
  const [cacheEpoch, bumpCache] = createSignal(0)
  onCleanup(subscribeCache(() => bumpCache((n) => n + 1)))
  const cachedLook = () => {
    cacheEpoch()
    return parseLook(readCache()?.text ?? null)
  }
  useCommands(
    themeCommands({
      mode: () => cachedLook().mode,
      darkTheme: () => cachedLook().darkTheme,
      setMode: (mode) => void live().then((m) => m.updateLook({ mode })),
      setBuiltin: (id) => void live().then((m) => m.chooseBuiltin(id)),
      imported: () => cachedLook().imported,
      setTheme: (appearance, id) =>
        void live().then((m) => {
          m.updateLook({ mode: appearance })
          m.choose(appearance, id)
        }),
      preview: ({ mode, darkTheme, active }) => {
        const saved = cachedLook()
        return previewLook({ ...saved, mode: mode ?? saved.mode, darkTheme: darkTheme ?? saved.darkTheme, imported: active ? { ...saved.imported, active } : saved.imported })
      },
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
