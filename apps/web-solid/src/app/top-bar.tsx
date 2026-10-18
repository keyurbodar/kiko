import { useLocation } from "@solidjs/router"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { NotesIcon, SearchIcon, SidebarRightIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show } from "solid-js"
import { cardShown, loadCard, toggleCard } from "../chat/side/card-state"
import { loadSidecar, sidecarOpen, toggleSidecar } from "../chat/side/surfaces"
import { runCommand } from "../commands/registry"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { preloadSearch } from "../search/state"
import { SidebarToggle } from "../sidebar"
import { sectionOf } from "./sections"

export function TopBar(props: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const location = useLocation()
  const chatId = () => {
    const id = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1]
    return id ? decodeURIComponent(id) : null
  }
  const toggle = (on: boolean) => `top-bar-button ${on ? "bg-accent text-foreground" : ""}`
  return (
    <Show when={sectionOf(location.pathname) === "chat"}>
      <header class="flex h-[50px] shrink-0 items-center gap-2 px-3" data-component="top-bar">
        <Show when={!props.sidebarOpen}>
          <SidebarToggle open={false} onToggle={props.onToggleSidebar} class="top-bar-button" />
        </Show>
        <div class="flex min-w-0 flex-1 items-center gap-2 px-1">
          <Show when={chatId()} keyed>
            {(id) => <ChatAvatar faces={useApp.chatFaces(id)} size={20} />}
          </Show>
          <h1 class="min-w-0 truncate text-md font-medium text-foreground" data-component="top-bar-title">
            {(chatId() && useApp.chatById(chatId()!)?.name) || "New chat"}
          </h1>
        </div>
        <TooltipV2 placement="bottom" openDelay={400} value="Search messages">
          <button
            type="button"
            class="top-bar-button"
            aria-label="Search messages"
            data-action="search-messages"
            data-hint="chats.search-current"
            data-hint-label="Search"
            onPointerEnter={preloadSearch}
            onClick={() => runCommand(chatId() ? "chats.search-current" : "chats.search-all")}
          >
            <RemixIcon icon={SearchIcon} size={16} />
          </button>
        </TooltipV2>
        <Show when={chatId()} keyed>
          {(id) => (
            <>
              <TooltipV2 placement="bottom" openDelay={400} value={cardShown() ? "Hide chat card" : "Show chat card"}>
                <button
                  type="button"
                  class={toggle(cardShown())}
                  aria-label="Chat card"
                  aria-pressed={cardShown()}
                  data-action="toggle-card"
                  data-hint="chat.info"
                  data-hint-label="Card"
                  onPointerEnter={() => void loadCard()}
                  onClick={toggleCard}
                >
                  <RemixIcon icon={NotesIcon} size={15} />
                </button>
              </TooltipV2>
              <TooltipV2 placement="bottom" openDelay={400} value={sidecarOpen(id) ? "Hide side panel" : "Show side panel"}>
                <button
                  type="button"
                  class={toggle(sidecarOpen(id))}
                  aria-label="Side panel"
                  aria-pressed={sidecarOpen(id)}
                  data-action="toggle-sidecar"
                  onPointerEnter={() => void loadSidecar()}
                  onClick={() => toggleSidecar(id)}
                >
                  <RemixIcon icon={SidebarRightIcon} size={15} />
                </button>
              </TooltipV2>
            </>
          )}
        </Show>
      </header>
    </Show>
  )
}
