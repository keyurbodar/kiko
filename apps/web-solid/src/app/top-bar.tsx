import { RemixIcon } from "@kiko/ui/remix-icon"
import { FolderIcon, MonitorIcon, SearchIcon, SidebarRightIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { computers, openViewer, startComputers, watchTarget } from "../chat/computers"
import { closeDesk, deskShown, deskView, fixedSurface, loadDesk, openSurface } from "../chat/side/surfaces"
import { threadDetailsOpenFor, toggleThreadDetails } from "../chat/side/thread-details-layer"
import { runCommand } from "../commands/registry"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { connection, createDelayedStatus, type ConnectionView } from "../state/connection"
import { room } from "../state/room"
import { presenceWords } from "../state/live-status"
import { user } from "../state/user"
import { preloadSearch } from "../search/state"
import { SidebarToggle } from "../sidebar"

const CONNECTION_LABEL: Partial<Record<ConnectionView, string>> = {
  reconnecting: "Reconnecting",
  disconnected: "Not connected",
}

const LONG_OFFLINE_MS = 10_000

export function TopBar(props: { chatId: string | null; sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const chatId = () => props.chatId
  const offline = createDelayedStatus(() => CONNECTION_LABEL[connection.view()] ?? null)
  const [long, setLong] = createSignal(false)
  createEffect(() => {
    if (!offline()) return setLong(false)
    const timer = setTimeout(() => setLong(true), LONG_OFFLINE_MS)
    onCleanup(() => clearTimeout(timer))
  })
  const title = () => {
    const id = chatId()
    if (!id) return "Chats"
    const name = room.chatById(id)?.name
    if (name) return name
    return user.loaded() ? "" : "Loading…"
  }
  onMount(startComputers)
  const toggle = () => "top-bar-button"
  const filesOpen = () => {
    const id = chatId()
    if (!id || !deskShown()) return false
    const kind = deskView(id)?.kind
    return kind === "files" || kind === "file"
  }
  const live = () => {
    const bot = chatId() ? room.chatById(chatId()!) : undefined
    if (!bot || (bot.presence !== "working" && bot.presence !== "typing")) return null
    return bot.typing ?? presenceWords(bot.presence)
  }
  const roster = () => {
    const names = room.members().map((member) => member.name)
    if (names.length < 2) return ""
    return `You, ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  }
  return (
    <header class="top-bar flex h-[52px] shrink-0 items-center gap-0.5 px-7" data-component="top-bar">
      <Show when={!props.sidebarOpen}>
        <SidebarToggle open={false} onToggle={props.onToggleSidebar} class="top-bar-button" />
      </Show>
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <Show when={chatId()} keyed>
          {(id) => <ChatAvatar faces={room.chatFaces(id)} size={22} />}
        </Show>
        <h1
          class="min-w-0 shrink truncate font-sans text-[15px] leading-[19px] font-semibold text-[var(--text-primary)]"
          data-component="top-bar-title"
        >
          {title()}
        </h1>
        <Show when={chatId()}>
          <Show when={live()} fallback={<span class="hidden">{roster()}</span>}>
            {(text) => (
              <span class="top-bar-sub chat-shimmer truncate text-sm" data-component="top-bar-status">
                {text()}
              </span>
            )}
          </Show>
        </Show>
        <Show when={offline()}>
          {(message) => (
            <span
              class={`min-w-0 truncate text-sm ${long() ? "text-tertiary" : "chat-shimmer"}`}
              role="status"
              data-component="connection-status"
            >
              {long() ? "Offline, messages will send when you're back" : message()}
            </span>
          )}
        </Show>
      </div>
      <Show when={chatId()}>
        <TooltipV2 placement="bottom" openDelay={500} value="Thread details">
          <button
            type="button"
            class="top-bar-button"
            aria-label="Thread details"
            aria-pressed={threadDetailsOpenFor(chatId())}
            data-action="toggle-thread-details"
            onClick={() => {
              const id = chatId()
              if (id) toggleThreadDetails(id)
            }}
          >
            <RemixIcon icon={SidebarRightIcon} size={18} />
          </button>
        </TooltipV2>
      </Show>
      <TooltipV2 placement="bottom" openDelay={500} value="Search messages">
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
          <RemixIcon icon={SearchIcon} size={18} />
        </button>
      </TooltipV2>
      <Show when={computers().length > 0}>
        <TooltipV2 placement="bottom" openDelay={500} value="Watch your computer">
          <button
            type="button"
            class="top-bar-button"
            aria-label="Watch your computer"
            data-action="computer-watch"
            onClick={() => openViewer(watchTarget(chatId()))}
          >
            <RemixIcon icon={MonitorIcon} size={18} />
          </button>
        </TooltipV2>
      </Show>
      <Show when={chatId()}>
        <TooltipV2 placement="bottom" openDelay={500} value="Files">
          <button
            type="button"
            class={toggle()}
            aria-label="Files"
            aria-pressed={filesOpen()}
            data-action="open-files"
            data-hint="chat.info"
            data-hint-label="Files"
            onPointerEnter={() => void loadDesk()}
            onClick={() => {
              const id = chatId()
              if (!id) return
              if (filesOpen()) closeDesk()
              else openSurface(id, fixedSurface("files"))
            }}
          >
            <RemixIcon icon={FolderIcon} size={18} />
          </button>
        </TooltipV2>
      </Show>
    </header>
  )
}
