import { useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { runCommand } from "../commands/registry"
import { BrandBird } from "../mascot/brand"
import { ModelPickerButton } from "../settings/model-picker"
import { sectionOf } from "./sections"
import { preloadSearch } from "../search/state"
import { SidebarToggle } from "../sidebar"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { SearchIcon, SidebarRightIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { useApp } from "../lib/store"
import { closeInfo, infoOpen, loadInfoPanel, openInfo } from "../chat/info/state"

/*
 * The 50 px bar over the main panel, laid out as kat's: the bird at the far left, the open chat's
 * title, and quiet controls on the right: the chat's model, message search, and the details panel.
 * The bird is the new chat button. Every button is the sidebar's icon button, under a tooltip.
 * Other sections have no bar: the sidebar already names them, and their panel starts at the top.
 */
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
      <header class="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm font-medium text-muted" data-component="top-bar">
        <Show when={!props.sidebarOpen}>
          <SidebarToggle open={false} onToggle={props.onToggleSidebar} class="top-bar-button" />
        </Show>
        <TooltipV2 placement="bottom" openDelay={400} value="New chat">
          <button type="button" class="top-bar-button" aria-label="New chat" data-action="logo-new-chat" onClick={() => runCommand("chat.new")}>
            <BrandBird size={24} />
          </button>
        </TooltipV2>
        <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text" data-component="top-bar-title">
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
        {/* Monocode's panel toggle, at the bar's right edge: shows and hides the chat's details. */}
        <Show when={chatId()}>
          <TooltipV2 placement="bottom" openDelay={400} value={infoOpen() ? "Hide details" : "Show details"}>
            <button
              type="button"
              class="top-bar-button"
              aria-label={infoOpen() ? "Hide details" : "Show details"}
              aria-pressed={infoOpen()}
              data-action="toggle-details"
              data-hint="chat.info"
              data-hint-label="Details"
              onPointerEnter={() => void loadInfoPanel()}
              onClick={() => (infoOpen() ? closeInfo() : openInfo())}
            >
              <HugeIcon icon={SidebarRightIcon} size={16} />
            </button>
          </TooltipV2>
        </Show>
      </header>
    </Show>
  )
}
