import { useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { runCommand } from "../commands/registry"
import { KIKO } from "@kiko/protocol"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { ModelPickerButton } from "../settings/model-picker"
import { sectionOf } from "./sections"
import { preloadSearch } from "../search/state"
import { SidebarToggle } from "../sidebar"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { SearchIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { PanelRight } from "lucide-solid"
import { useApp } from "../lib/store"
import { loadSidecar, sidecarOpen, toggleSidecar } from "../chat/side/surfaces"

export function TopBar(props: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const location = useLocation()
  const section = () => sectionOf(location.pathname)
  const chatId = () => {
    const id = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1]
    return id ? decodeURIComponent(id) : null
  }
  const title = () => {
    const id = chatId()
    return (id && useApp.chatById(id)?.name) || "New chat"
  }
  return (
    <Show when={section() === "chat"}>
      <header class="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm font-medium text-muted-foreground" data-component="top-bar">
        <Show when={!props.sidebarOpen}>
          <SidebarToggle open={false} onToggle={props.onToggleSidebar} class="top-bar-button" />
        </Show>
        <TooltipV2 placement="bottom" openDelay={400} value="New chat">
          <button type="button" class="top-bar-button" aria-label="New chat" data-action="logo-new-chat" onClick={() => runCommand("chat.new")}>
            <IdentityAvatar seed={KIKO} size={24} />
          </button>
        </TooltipV2>
        <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-medium text-foreground" data-component="top-bar-title">
          {title()}
        </h1>
        <ModelPickerButton chatId={chatId()} />
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
            <HugeIcon icon={SearchIcon} size={16} />
          </button>
        </TooltipV2>

        <Show when={chatId()}>
          {(id) => (
            <>
              <Show when={!sidecarOpen(id())}>
              <TooltipV2 placement="bottom" openDelay={400} value="Show side panel">
                <button
                  type="button"
                  class="top-bar-button"
                  aria-label="Show side panel"
                  aria-pressed={false}
                  data-action="toggle-sidecar"
                  data-hint="chat.info"
                  data-hint-label="Details"
                  onPointerEnter={() => void loadSidecar()}
                  onClick={() => toggleSidecar(id())}
                >
                  <PanelRight size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </TooltipV2>
              </Show>
            </>
          )}
        </Show>
      </header>
    </Show>
  )
}
