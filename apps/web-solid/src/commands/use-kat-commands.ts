import { createSignal, onCleanup } from "solid-js"
import { history, openChat } from "../app/history"
import { useChatInView } from "../app/sections"
import { withMade } from "../files/api"
import { askDeleteChat, closeChat, reopenClosedChat, sidebarOrder, startRename, togglePin } from "../sidebar/actions"
import { signOut } from "../app/session"
import { fixedSurface, openFile, openSurface, toggleDesk } from "../chat/side/surfaces"
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
import { room } from "../state/room"
import { user } from "../state/user"
import { openBotPicker } from "../chat/bot-picker-state"
import { openNewAgent } from "../newagent/state"
import { navCommands } from "./nav-commands"
import { useCommands } from "./registry"
import { browserCommands, startBrowser } from "../chat/browser"
import { isMac } from "../lib/platform"

const [goTo, setGoTo] = createSignal<
  typeof import("../files/go-to") & { HOME: string; recentFiles: typeof import("../files/recent").recentFiles }
>()
const loadGoTo = () =>
  void Promise.all([import("../files/go-to"), import("../files/model"), import("../files/recent")]).then(([g, m, r]) =>
    setGoTo(() => ({ ...g, HOME: m.HOME, recentFiles: r.recentFiles })),
  )

export function useKatCommands(deps: { toggleSidebar: () => void }): void {
  startBrowser()
  useCommands(browserCommands())
  const activeId = useChatInView()
  useCommands(
    katCommands({
      mac: isMac,
      toggleSidebar: deps.toggleSidebar,
      newChat: openBotPicker,
      openPalette: () => openPalette(),
      openChats: () => openPalette("chats.go"),
      openView: openPalette,
      chatChoices: () =>
        room.bots().map((chat) => ({ id: chat.id, title: chat.name, chatId: chat.id, run: () => openChat(chat.id) })),
      agentChoices: () =>
        agentList(user.agents()).map((agent) => ({
          id: agent.id,
          title: agent.name,
          seed: agent.slug,
          run: () => {
            const roomId = user.createChat(agent.name, [agent.id])
            if (roomId) openChat(roomId)
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
          withMade(id, room.files()).map((f) => f.name),
          withMade(mod.HOME, user.homeFiles()).map((f) => f.name),
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
      copyLink: () => {
        const id = activeId()
        if (id) void navigator.clipboard?.writeText(`${window.location.origin}/chat/${id}`)
      },
      hasActiveChat: () => activeId() !== null,
      toggleCard: toggleDesk,
      openPanel: (kind) => {
        const id = activeId()
        if (id) openSurface(id, fixedSurface(kind))
      },
      closeChat: () => {
        const id = activeId()
        if (id) closeChat(id, id)
      },
      goToChat: (n) => {
        const row = sidebarOrder()[n - 1]
        if (row) openChat(row.id)
      },
      stepChat: (step) => {
        const order = sidebarOrder()
        const at = order.findIndex((r) => r.id === activeId())
        const row = order[at === -1 ? 0 : Math.max(0, Math.min(order.length - 1, at + step))]
        if (row && row.id !== activeId()) openChat(row.id)
      },
      chatCount: () => room.bots().length,
      searchChat: () => openSearch("chat"),
      reopenClosed: () => {
        const id = reopenClosedChat()
        if (id) openChat(id)
      },
      attach: () => document.querySelector<HTMLButtonElement>('[data-hint="chat.attach"]')?.click(),
      rename: () => {
        const id = activeId()
        if (id) startRename(id)
      },
      canMove: () => {
        const id = activeId()
        return id !== null && !user.chat(id)?.kiko
      },
      togglePin: () => {
        const id = activeId()
        if (id && !user.chat(id)?.kiko) togglePin(id)
      },
      deleteChat: () => {
        const id = activeId()
        if (id && !user.chat(id)?.kiko) askDeleteChat(id)
      },
    }),
  )
  useCommands([
    messageSearchCommand({
      open: (hit) => {
        requestJump({ roomId: hit.roomId, id: hit.id, seq: hit.seq })
        if (hit.roomId !== activeId()) openChat(hit.roomId)
      },
      openView: openPalette,
    }),
  ])
  const chipAgent = () => answeringMember(room.roomMembers(), "")
  useCommands(
    navCommands({
      openChats: () => openChat(null),
      signOut: () => void signOut(),
      chooseModel: () => {
        if (!history.location.pathname.startsWith("/chat")) openChat(room.activeId())
        openModelPicker()
      },
      openView: openPalette,
      canReason: () => canReason(user.agentModel(chipAgent()?.slug ?? "")?.thinkingLevels),
      reasoningChoices: () => {
        const agent = chipAgent()
        const picked = agent ? user.agentModel(agent.slug) : undefined
        if (!agent || !picked) return []
        return picked.thinkingLevels.map((level): Choice => ({
          id: level,
          title: THINKING_LABELS[level],
          current: level === picked.thinking,
          run: () => room.setAgentModel(agent.slug, { thinking: level }),
        }))
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
      builtin: () => ({ dark: cachedLook().darkTheme, light: cachedLook().lightTheme }),
      setMode: (mode) => void live().then((m) => m.updateLook({ mode })),
      setBuiltin: (id) => void live().then((m) => m.chooseBuiltin(id)),
      imported: () => cachedLook().imported,
      setTheme: (appearance, id) =>
        void live().then((m) => {
          m.updateLook({ mode: appearance })
          m.choose(appearance, id)
        }),
      preview: ({ mode, darkTheme, lightTheme, active }) => {
        const saved = cachedLook()
        return previewLook({
          ...saved,
          mode: mode ?? saved.mode,
          darkTheme: darkTheme ?? saved.darkTheme,
          lightTheme: lightTheme ?? saved.lightTheme,
          imported: active ? { ...saved.imported, active } : saved.imported,
        })
      },
      openView: openPalette,
      activeAgent: () => {
        const id = activeId()
        const faces = id ? room.chatFaces(id) : []
        return faces.length === 1 ? faces[0]! : null
      },
      changeAvatar: openAvatarPicker,
    }),
  )
}
