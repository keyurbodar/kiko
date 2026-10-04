import { useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { runCommand } from "../commands/registry"
import { Bird } from "../mascot/bird"
import { ModelPickerButton } from "../settings/model-picker"
import { sectionOf } from "./sections"
import { TabStrip } from "./tab-strip"
import { preloadSearch } from "../search/state"

/*
 * The 50 px bar over the main panel, laid out as kat's: the bird at the far left, the chat tabs,
 * and two quiet controls on the right, the chat's model and message search. The bird is the new chat button: it turns
 * into a + under the pointer, as kat's cat does.
 * Other sections have no bar: the sidebar already names them, and their panel starts at the top.
 */
export function TopBar() {
  const location = useLocation()
  const section = () => sectionOf(location.pathname)
  const chatId = () => {
    const id = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1]
    return id ? decodeURIComponent(id) : null
  }
  return (
    <Show when={section() === "chat"}>
      <header class="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm font-medium text-muted" data-component="top-bar">
        <button
          type="button"
          class="group/new grid size-8 shrink-0 place-items-center rounded-[9px] text-[var(--tab-text)] hover:bg-[var(--tab-bg-hover)] hover:text-[var(--tab-text-active)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          aria-label="new chat"
          title="new chat"
          data-action="logo-new-chat"
          onClick={() => runCommand("chat.new")}
        >
          <span class="contents group-hover/new:hidden group-focus-visible/new:hidden">
            <Bird spec={{ species: "kiko", tint: 0, accessory: "none" }} size={24} />
          </span>
          <svg class="hidden group-hover/new:block group-focus-visible/new:block" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M8 2.5v11M2.5 8h11" />
          </svg>
        </button>
        <TabStrip />
        <span class="flex-1" aria-hidden="true" />
        <ModelPickerButton chatId={chatId()} />
        <button
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-[9px] text-[var(--tab-text)] hover:bg-[var(--tab-bg-hover)] hover:text-[var(--tab-text-active)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          aria-label="search messages"
          title="search messages"
          data-action="search-messages"
          data-hint="chats.search-current"
          onPointerEnter={preloadSearch}
          onClick={() => runCommand(chatId() ? "chats.search-current" : "chats.search-all")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path d="M14 14l-3.65-3.65M6.9 11.78a4.89 4.89 0 1 0 0-9.78 4.89 4.89 0 0 0 0 9.78Z" />
          </svg>
        </button>
      </header>
    </Show>
  )
}
