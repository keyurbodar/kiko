import { RemixIcon } from "@kiko/ui/remix-icon"
import { MonitorIcon, NotesIcon, SearchIcon, SidebarRightIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, onMount } from "solid-js"
import { computers, openViewer, startComputers, watchTarget } from "../chat/computers"
import { cardShown, loadCard, toggleCard } from "../chat/side/card-state"
import { loadSidecar, sidecarOpen, toggleSidecar } from "../chat/side/surfaces"
import { runCommand } from "../commands/registry"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { connection, createDelayedStatus, type ConnectionView } from "../state/connection"
import { room } from "../state/room"
import { user } from "../state/user"
import { preloadSearch } from "../search/state"
import { SidebarToggle } from "../sidebar"

const CONNECTION_LABEL: Partial<Record<ConnectionView, string>> = {
  reconnecting: "Reconnecting",
  disconnected: "Not connected",
  outdated: "Reload to reconnect",
}

export function TopBar(props: { chatId: string | null; sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const chatId = () => props.chatId
  const offline = createDelayedStatus(() => CONNECTION_LABEL[connection.view()] ?? null)
  const title = () => {
    const id = chatId()
    if (!id) return "Chats"
    const name = room.chatById(id)?.name
    if (name) return name
    return user.loaded() ? "" : "Loading…"
  }
  onMount(startComputers)
  const toggle = (on: boolean) => `top-bar-button ${on ? "bg-accent text-foreground" : ""}`
  return (
    <header class="flex h-[50px] shrink-0 items-center gap-2 px-3" data-component="top-bar">
      <Show when={!props.sidebarOpen}>
        <SidebarToggle open={false} onToggle={props.onToggleSidebar} class="top-bar-button" />
      </Show>
      <div class="flex min-w-0 flex-1 items-center gap-2.5 px-1">
        <Show when={chatId()} keyed>
          {(id) => <ChatAvatar faces={room.chatFaces(id)} size={32} />}
        </Show>
        <h1 class="min-w-0 truncate text-md font-medium text-foreground" data-component="top-bar-title">
          {title()}
        </h1>
        <Show when={offline()}>
          {(message) => (
            <span
              class="shrink-0 rounded-full bg-warning-surface px-2 py-0.5 text-[11px] text-warning"
              role="status"
              data-component="connection-status"
            >
              {message()}
            </span>
          )}
        </Show>
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
      <Show when={computers().length > 0}>
        <TooltipV2 placement="bottom" openDelay={400} value="Watch your computer">
          <button
            type="button"
            class="top-bar-button"
            aria-label="Watch your computer"
            data-action="computer-watch"
            onClick={() => openViewer(watchTarget(chatId()))}
          >
            <RemixIcon icon={MonitorIcon} size={16} />
          </button>
        </TooltipV2>
      </Show>
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
            <TooltipV2
              placement="bottom"
              openDelay={400}
              value={sidecarOpen(id) ? "Hide side panel" : "Show side panel"}
            >
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
  )
}
