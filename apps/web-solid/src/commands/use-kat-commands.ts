import { useLocation, useNavigate } from "@solidjs/router"
import { closeChat, deleteChat, startRename, togglePin } from "../sidebar/actions"
import { openTabs } from "../app/open-tabs"
import { signOut } from "../app/session"
import { toggleFiles, toggleInfo } from "../chat/info/state"
import { openModelPicker } from "../settings/model-picker"
import { openPalette } from "../palette/state"
import { katCommands } from "./kat-commands"
import { themeCommands } from "./theme-commands"
import { openBirdPicker } from "../mascot/picker-state"
import { useApp } from "../lib/store"
import { setPickFor } from "../chat/to-bar-state"
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
      // The one way to start a chat: a temporary chat with kiko, in a new tab (architecture section 7.11).
      newChat: () => {
        const id = useApp.createTemp()
        if (id) navigate(`/chat/${id}`)
      },
      // A group starts the same way, with the "to:" search already open.
      newGroup: () => {
        const id = useApp.createTemp()
        if (!id) return
        setPickFor(id)
        navigate(`/chat/${id}`)
      },
      openPalette: () => openPalette("commands"),
      openChats: () => openPalette("chats"),
      hasActiveChat: () => activeId() !== null,
      toggleInfo,
      toggleFiles,
      closeChat: () => {
        const id = activeId()
        if (id) closeChat(id, id, navigate)
      },
      reopenClosed: () => {
        const id = openTabs.takeClosed((id) => !!useApp.chat(id))
        if (id) navigate(`/chat/${id}`)
      },
      attach: () => document.querySelector<HTMLButtonElement>(".composer-attach")?.click(),
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
  useCommands(
    navCommands({
      go: (href) => navigate(href),
      signOut: () => void signOut(),
      chooseModel: () => {
        // The picker lives in the chat top bar, so go there first when somewhere else.
        if (!location.pathname.startsWith("/chat")) navigate("/chat")
        openModelPicker()
      },
    }),
  )
  const live = () => import("../theme/live")
  useCommands(
    themeCommands({
      setPreset: (preset) => void live().then((m) => m.updateLook({ theme: { preset } })),
      setMode: (mode) => void live().then((m) => m.updateLook({ mode })),
      activeAgent: () => {
        const id = activeId()
        const faces = id ? useApp.chatFaces(id) : []
        return faces.length === 1 ? faces[0]! : null
      },
      changeBird: openBirdPicker,
    }),
  )
}
