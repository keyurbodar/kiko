import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, MuteIcon, SearchIcon, UnreadIcon } from "@kiko/ui/icons"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { openAvatarPicker } from "../avatar/picker-state"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js"
import { VList } from "virtua/solid"
import { useCommands, type Command } from "../commands/registry"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { intentRef } from "../lib/intent"
import { agentDisplayName } from "../lib/names"
import { useApp } from "../lib/store"
import type { BotPresence, RosterBot } from "../lib/types"
import {
  cancelRename,
  clearUnreadMark,
  closeChat,
  commitRename,
  deleteChat,
  markedUnread,
  markUnread,
  renamingId,
  startRename,
  toggleMute,
  togglePin,
} from "./actions"
import { isListed, quoteOf } from "./activity"
import { filterRows, pinnedRows } from "./filter"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const ROW_H = 52
const SKELETON_ROWS = [62, 48, 70, 54, 66, 44]

export function rowStamp(updatedAt: number, now: number): string {
  const delta = now - updatedAt
  if (delta < MINUTE) return "now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  return `${Math.floor(delta / DAY)}d`
}

const PRESENCE: Record<BotPresence, string> = { idle: "Idle", typing: "Typing", working: "Working", sleeping: "Sleeping" }

function ChatMenuItems(props: { id: string }) {
  const navigate = useNavigate()
  const chat = createMemo(() => useApp.user()?.chats().find((c) => c.roomId === props.id))
  const active = () => useApp.activeThreadId()
  const [sure, setSure] = createSignal(false)
  return (
    <>
      <MenuV2.Item onSelect={() => startRename(props.id)} shortcut="F2">Rename</MenuV2.Item>

      <Show when={!chat()?.kiko} fallback={<MenuV2.Item disabled>Always pinned</MenuV2.Item>}>
        <MenuV2.Item onSelect={() => togglePin(props.id)}>{chat()?.pinned ? "Unpin" : "Pin"}</MenuV2.Item>
      </Show>
      <MenuV2.Item onSelect={() => toggleMute(props.id)}>{chat()?.muted ? "Unmute" : "Mute"}</MenuV2.Item>
      <Show when={useApp.chatFaces(props.id).length === 1}>
        <MenuV2.Item onSelect={() => openAvatarPicker(useApp.chatFaces(props.id)[0]!)}>Change avatar</MenuV2.Item>
      </Show>
      <MenuV2.Separator />
      <MenuV2.Item onSelect={() => markUnread(props.id)}>Mark as unread</MenuV2.Item>
      <MenuV2.Item onSelect={() => closeChat(props.id, active(), navigate)}>Close</MenuV2.Item>
      <MenuV2.Separator />
      <Show when={!chat()?.kiko} fallback={<MenuV2.Item disabled>Kiko can't be deleted</MenuV2.Item>}>
        <MenuV2.Item
          class="text-error"
          closeOnSelect={false}
          onSelect={() => (sure() ? deleteChat(props.id, active(), navigate) : setSure(true))}
        >
          {sure() ? "Delete chat?" : "Delete"}
        </MenuV2.Item>
      </Show>
    </>
  )
}

const [openPreview, setOpenPreview] = createSignal<string | null>(null)

// A preview shows only while the pointer or focus rests on its row. Any click or key
// elsewhere, such as Ctrl+K or opening the chat card, ends it.
if (typeof document !== "undefined") {
  const close = () => setOpenPreview(null)
  document.addEventListener("pointerdown", close, true)
  document.addEventListener("keydown", (event) => {
    if (!["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) close()
  }, true)
}

function previewState(id: string) {
  const open = () => openPreview() === id
  const set = (on: boolean) => {
    if (on) setOpenPreview(id)
    else if (open()) setOpenPreview(null)
  }
  return [open, set] as const
}

function PinTile(props: { bot: RosterBot; active: boolean; main: boolean; onSelect: () => void; hint?: string }) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = previewState(props.bot.id)
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id)
  return (
    <MenuV2.Context gutter={8} onOpenChange={setMenuOpen}>
      <MenuV2.Context.Trigger as="div" class="pin-tile-slot" data-chat-id={props.bot.id} data-main={props.main ? "" : undefined} data-hint={props.hint} data-hint-label="Chat" data-hint-side="right">
        <HoverCardV2
          open={previewOpen() && !menuOpen()}
          onOpenChange={setPreviewOpen}
          openDelay={400}
          closeDelay={150}
          placement="right-start"
          gutter={12}
        >
          <HoverCardV2.Trigger
            as="button"
            type="button"
            class="pin-tile"
            ref={intentRef(() => void useApp.preloadChat(props.bot.id))}
            data-component="sidebar-pin-tile"
            data-chat-id={props.bot.id}
            data-active={props.active ? "" : undefined}
            data-unread={unread() ? "" : undefined}
            data-main={props.main ? "" : undefined}
            aria-current={props.active ? "true" : undefined}
            onClick={() => {
              setPreviewOpen(false)
              props.onSelect()
            }}
          >
            <span class="pin-tile-circle">
              <span class="pin-tile-icon">
                <ChatAvatar faces={useApp.chatFaces(props.bot.id)} class="pin-tile-avatar" />
              </span>
              <Show when={unread()}>
                <span class="unread-dot pin-tile-dot" aria-hidden="true" />
              </Show>
            </span>
            <Show when={props.main} fallback={<span class="pin-tile-name">{props.bot.name}</span>}>
              <span class="pin-tile-text">
                <span class="pin-tile-name">{props.bot.name}</span>
                <span class="pin-tile-sub">{props.bot.presence === "idle" ? props.bot.preview || "Your main agent" : PRESENCE[props.bot.presence]}</span>
              </span>
            </Show>
          </HoverCardV2.Trigger>

          <HoverCardV2.Portal>
            <HoverCardV2.Content>
              <ChatPreview bot={props.bot} />
            </HoverCardV2.Content>
          </HoverCardV2.Portal>
        </HoverCardV2>
      </MenuV2.Context.Trigger>

      <MenuV2.Context.Portal>
        <MenuV2.Context.Content data-component="sidebar-pin-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <ChatMenuItems id={props.bot.id} />
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

function ChatPreview(props: { bot: RosterBot }) {
  const tail = createMemo(() => useApp.messagesFor(props.bot.id).filter(isListed).slice(-3))
  const name = (slug: string) => useApp.memberById(slug)?.name ?? agentDisplayName(slug, [])

  return (
    <div class="w-[280px] p-3" data-component="sidebar-preview">
      <div class="flex items-center gap-2.5">
        <ChatAvatar faces={useApp.chatFaces(props.bot.id)} size={32} />
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-foreground">{props.bot.name}</div>
          <div class="truncate text-[11px] text-muted-foreground">{PRESENCE[props.bot.presence]}</div>
        </div>
      </div>

      <Show when={tail().length > 0}>
        <div class="mt-2.5 flex flex-col gap-1.5">
          <For each={tail()}>
            {(message) => (
              <p class="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                <span class="font-semibold text-foreground">{message.sender === "user" ? "You" : (useApp.memberById(message.botId)?.name ?? props.bot.name)}:</span>{" "}
                {quoteOf(message, name)}
              </p>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function RowTitle(props: { id: string; title: string }) {
  let input: HTMLInputElement | undefined
  let done = false
  const editing = () => renamingId() === props.id
  createEffect(() => {
    if (!editing()) return
    done = false
    setTimeout(() => {
      input?.focus()
      input?.select()
    }, 0)
  })
  return (
    <Show when={editing()} fallback={<span class="chat-name">{props.title}</span>}>
      <input
        ref={(el) => (input = el)}
        class="chat-rename"
        data-component="sidebar-rename"
        aria-label="Chat name"
        value={props.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") {
            done = true
            commitRename(props.id, e.currentTarget.value)
          } else if (e.key === "Escape") {
            done = true
            cancelRename()
          }
        }}
        onBlur={(e) => {
          if (done) return
          done = true
          commitRename(props.id, e.currentTarget.value)
        }}
      />
    </Show>
  )
}

function ChatRow(props: { bot: RosterBot; muted: boolean; active: boolean; now: number; hint?: string }) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = previewState(props.bot.id)
  const navigate = useNavigate()
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id)
  const draft = () => {
    const book = useApp.drafts()
    return props.active || !book?.has(props.bot.id) ? "" : (book.get(props.bot.id)?.text.trim() ?? "")
  }

  const select = () => {
    clearUnreadMark(props.bot.id)
    navigate(`/chat/${props.bot.id}`)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    select()
  }

  return (
    <MenuV2.Context gutter={8} onOpenChange={setMenuOpen}>
      <MenuV2.Context.Trigger
        as="div"
        class="chat-row"
        ref={intentRef(() => void useApp.preloadChat(props.bot.id))}
        data-component="sidebar-row"
        data-chat-id={props.bot.id}
        data-hint={props.hint}
        data-hint-label="Chat"
        data-hint-side="right"
        data-active={props.active ? "" : undefined}
        data-unread={unread() ? "" : undefined}
        data-draft={draft() ? "" : undefined}
        data-muted={props.muted ? "" : undefined}
        aria-current={props.active ? "true" : undefined}
        role="button"
        tabindex={0}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        <HoverCardV2
          open={previewOpen() && !menuOpen() && renamingId() !== props.bot.id}
          onOpenChange={setPreviewOpen}
          openDelay={400}
          closeDelay={150}
          placement="right-start"
          gutter={12}
        >
          <HoverCardV2.Trigger as="span" class="absolute inset-0 z-[1]" aria-hidden="true" />
          <HoverCardV2.Portal>
            <HoverCardV2.Content>
              <ChatPreview bot={props.bot} />
            </HoverCardV2.Content>
          </HoverCardV2.Portal>
        </HoverCardV2>

        <ChatAvatar faces={useApp.chatFaces(props.bot.id)} class="chat-avatar" />

        <span class="chat-text">
          <span class="chat-line">
            <RowTitle id={props.bot.id} title={props.bot.name} />
            <Show when={props.muted}>
              <RemixIcon icon={MuteIcon} size={12} class="chat-muted-icon" />
            </Show>
            <span class="chat-time">{rowStamp(props.bot.updatedAt, props.now)}</span>
          </span>

          <span class="chat-line">
            <span
              class="chat-preview"
              data-typing={props.bot.presence === "typing" ? "" : undefined}
              data-empty={!props.bot.preview && !draft() && props.bot.presence !== "typing" ? "" : undefined}
            >
              <Show
                when={props.bot.presence === "typing"}
                fallback={
                  <Show
                    when={draft()}
                    fallback={
                      <>
                        <Show when={props.bot.previewFrom}>
                          <span class="chat-preview-from" data-component="sidebar-preview-from">{props.bot.previewFrom}:</span>{" "}
                        </Show>
                        {props.bot.preview}
                      </>
                    }
                  >
                    <span class="chat-draft" data-component="sidebar-draft">Draft:</span> {draft()}
                  </Show>
                }
              >
                {props.bot.typing ?? "Typing"}
                <i class="chat-typing-dot" aria-hidden="true" />
                <i class="chat-typing-dot" aria-hidden="true" />
                <i class="chat-typing-dot" aria-hidden="true" />
              </Show>
            </span>

            <Show when={props.bot.mentions}>
              <i class="chat-mention-badge" data-component="sidebar-mention-badge" role="img" aria-label="You were mentioned">@</i>
            </Show>
            <Show when={unread()}>
              <Show
                when={props.bot.unread > 0}
                fallback={<i class="unread-dot chat-unread-dot" data-component="sidebar-unread-dot" aria-label="Marked unread" role="img" />}
              >
                <span class="chat-count" data-component="sidebar-unread-count" role="img" aria-label={`${props.bot.unread} unread`}>
                  {props.bot.unread > 99 ? "99+" : props.bot.unread}
                </span>
              </Show>
            </Show>
          </span>
        </span>
      </MenuV2.Context.Trigger>

      <MenuV2.Context.Portal>
        <MenuV2.Context.Content data-component="sidebar-chat-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <ChatMenuItems id={props.bot.id} />
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

function SearchRow(props: {
  query: string
  onQuery: (query: string) => void
  unreadOnly: boolean
  onUnreadOnly: (on: boolean) => void
}): JSX.Element {
  return (
    <div class="chat-search" data-component="sidebar-search" data-hint="chats.go" data-hint-label="Go to chat">
      <label class="chat-search-field">
        <RemixIcon icon={SearchIcon} size={15} />
        <input
          type="text"
          class="chat-search-input"
          data-component="sidebar-search-input"
          placeholder="Search"
          aria-label="Search chats"
          autocomplete="off"
          spellcheck={false}
          value={props.query}
          onInput={(e) => props.onQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && props.query !== "") {
              e.preventDefault()
              props.onQuery("")
            }
          }}
        />
        <Show when={props.query !== ""}>
          <button type="button" class="chat-search-clear" data-component="sidebar-search-clear" aria-label="Clear search" onClick={() => props.onQuery("")}>
            <RemixIcon icon={CloseIcon} size={13} />
          </button>
        </Show>
      </label>
      <TooltipV2 placement="bottom" openDelay={400} value="Unread only">
        <button
          type="button"
          class="chat-filter"
          data-component="sidebar-filter"
          aria-label="Show unread only"
          aria-pressed={props.unreadOnly}
          onClick={() => props.onUnreadOnly(!props.unreadOnly)}
        >
          <RemixIcon icon={UnreadIcon} size={16} />
        </button>
      </TooltipV2>
    </div>
  )
}

export function ChatPanel() {
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(clock))
  const navigate = useNavigate()
  const [query, setQuery] = createSignal("")
  const [unreadOnly, setUnreadOnly] = createSignal(false)

  const all = createMemo(() => useApp.bots())
  const shown = createMemo(() =>
    filterRows(all(), { query: query(), unreadOnly: unreadOnly() }, (row) => row.unread > 0 || markedUnread(row.id)),
  )
  const pinned = createMemo(() => pinnedRows(shown(), useApp.kikoChatId()))
  const jumpHint = createMemo(() => {
    const order = [...all().filter((b) => b.pinned), ...all().filter((b) => !b.pinned)].slice(0, 9)
    return new Map(order.map((b, i) => [b.id, `chats.go-${i + 1}`]))
  })
  const rowIds = createMemo(() => shown().filter((bot) => !bot.pinned).map((bot) => bot.id))
  const byId = createMemo(() => new Map(shown().map((bot) => [bot.id, bot])))
  const muted = createMemo(() => new Set((useApp.user()?.chats() ?? []).filter((c) => c.muted).map((c) => c.roomId as string)))
  const active = () => useApp.activeThreadId()
  const loading = () => all().length === 0 && !!useApp.user()?.state.loaded && !useApp.user()?.state.synced

  return (
    <div class="chat-panel" data-component="sidebar-chats">
      <SearchRow query={query()} onQuery={setQuery} unreadOnly={unreadOnly()} onUnreadOnly={setUnreadOnly} />
      <Show when={pinned().length > 0}>
        <div class="pinned-grid">
          <For each={pinned()}>
            {(bot) => (
              <PinTile
                bot={bot}
                hint={jumpHint().get(bot.id)}
                active={active() === bot.id}
                main={bot.id === useApp.kikoChatId()}
                onSelect={() => {
                  clearUnreadMark(bot.id)
                  navigate(`/chat/${bot.id}`)
                }}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={pinned().length > 0 && rowIds().length > 0}>
        <div class="chat-section" data-component="sidebar-chats-label">Chats</div>
      </Show>
      <Show when={shown().length === 0 && (query() !== "" || unreadOnly())}>
        <div class="flex flex-col items-center gap-2 py-6" data-component="sidebar-empty">
          <p class="text-xs text-muted-foreground">No chats match</p>
        </div>
      </Show>
      <Show when={loading()}>
        <div class="chat-skeleton-list" data-component="sidebar-skeleton" aria-hidden="true">
          <For each={SKELETON_ROWS}>
            {(width) => (
              <div class="chat-skeleton-row">
                <span class="chat-skeleton chat-skeleton-avatar motion-skeleton" />
                <span class="chat-skeleton-text">
                  <span class="chat-skeleton motion-skeleton" style={{ width: `${width}%` }} />
                  <span class="chat-skeleton motion-skeleton" style={{ width: `${width - 20}%` }} />
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <VList class="chat-list" data={rowIds()} itemSize={ROW_H} bufferSize={ROW_H * 4} data-component="sidebar-list">
        {(id) => (
          <Show when={byId().get(id)}>
            {(bot) => <ChatRow bot={bot()} muted={muted().has(id)} active={active() === id} now={now()} hint={jumpHint().get(id)} />}
          </Show>
        )}
      </VList>
    </div>
  )
}
