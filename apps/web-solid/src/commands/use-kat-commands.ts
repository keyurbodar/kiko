import { useLocation, useNavigate } from "@solidjs/router"
import { nextAfterClose, openTabs } from "../app/open-tabs"
import { openPalette } from "../palette/state"
import { katCommands } from "./kat-commands"
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
    return id && id !== "new" ? decodeURIComponent(id) : null
  }
  useCommands(
    katCommands({
      toggleSidebar: deps.toggleSidebar,
      newChat: () => navigate("/chat/new"),
      openPalette: () => openPalette("commands"),
      openChats: () => openPalette("chats"),
      hasActiveChat: () => activeId() !== null,
      closeChat: () => {
        const id = activeId()
        if (!id) return
        const next = nextAfterClose(openTabs.ids(), id, id)
        openTabs.close(id)
        navigate(next ? `/chat/${next}` : "/chat")
      },
    }),
  )
}
