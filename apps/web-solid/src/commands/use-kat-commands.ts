import { useLocation, useNavigate } from "@solidjs/router"
import { createSignal, onCleanup } from "solid-js"
import { closeChat, deleteChat, reopenClosedChat, sidebarOrder, startRename, togglePin } from "../sidebar/actions"
import { signOut } from "../app/session"
import { toggleCard } from "../chat/side/card-state"
import { fixedSurface, openSurface } from "../chat/side/surfaces"
import { openModelPicker } from "../settings/model-picker"
import { openPalette } from "../palette/state"
import { openSearch } from "../search/state"
import { katCommands } from "./kat-commands"
import { themeCommands } from "./theme-commands"
import { openAvatarPicker } from "../avatar/picker-state"
import { useApp } from "../lib/store"
import { setPickFor } from "../chat/to-bar-state"
import { navCommands } from "./nav-commands"
import { useCommands } from "./registry"

const CHAT_PATH = /^\/chat\/([^/]+)$/
const COMPOSER_FIELD = ".ProseMirror"

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
  // A signal, not a read of activeElement: tanstack stores the `enabled` it was given and refreshes it
  // only when a signal it read changes, so focus has to be a signal for Mod+K to follow it.
  const [inComposer, setInComposer] = createSignal(false)
  const onFocusIn = (event: FocusEvent) => setInComposer(event.target instanceof Element && event.target.closest(COMPOSER_FIELD) !== null)
  const onFocusOut = () => setInComposer(false)
  document.addEventListener("focusin", onFocusIn)
  document.addEventListener("focusout", onFocusOut)
  onCleanup(() => {
    document.removeEventListener("focusin", onFocusIn)
    document.removeEventListener("focusout", onFocusOut)
  })
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
      inRichEditor: inComposer,
      openChats: () => openPalette("chats"),
      hasActiveChat: () => activeId() !== null,
      toggleCard,
      openFiles: () => {
        const id = activeId()
        if (id) openSurface(id, fixedSurface("files"))
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
      searchAll: () => openSearch("all"),
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
      setMode: (mode) => void live().then((m) => m.updateLook({ mode })),
      activeAgent: () => {
        const id = activeId()
        const faces = id ? useApp.chatFaces(id) : []
        return faces.length === 1 ? faces[0]! : null
      },
      changeAvatar: openAvatarPicker,
    }),
  )
}
