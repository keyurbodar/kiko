import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { openBirdPicker } from "../mascot/picker-state"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, type JSX, Show } from "solid-js"
import { VList } from "virtua/solid"
import { useCommands, type Command } from "../commands/registry"
import { cn } from "../lib/cn"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { intentRef } from "../lib/intent"
import { useApp } from "../lib/store"
import type { RosterBot } from "../lib/types"
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
import { filterRows } from "./filter"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Row height in px. Fixed, so the virtualizer never measures and never shows a blank row. */
export const ROW_H = 52

/**
 * The stamp at the end of a row's first line. Relative, not a clock time:
 * `updatedAt` is last activity, and the question a list answers at a glance is
 * "how stale is this". Coarse on purpose, so it never needs a ticking timer.
 */
export function rowStamp(updatedAt: number, now: number): string {
  const delta = now - updatedAt
  if (delta < MINUTE) return "now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  return `${Math.floor(delta / DAY)}d`
}

const menuClass = cn(
  "min-w-[180px] rounded-[calc(20px*var(--brm))] p-2",
  "border-none bg-menu text-base text-text shadow-menu",
)

/** What every chat's menu holds, in kat's order (screenshot 16). */
function ChatMenuItems(props: { id: string }) {
  const navigate = useNavigate()
  const chat = createMemo(() => useApp.user()?.chats().find((c) => c.roomId === props.id))
  const active = () => useApp.activeThreadId()
  const [sure, setSure] = createSignal(false)
  return (
    <>
      <MenuV2.Item onSelect={() => startRename(props.id)} shortcut="F2">rename</MenuV2.Item>
      {/* The kiko chat is the chief's tile: always pinned, never deleted. */}
      <Show when={!chat()?.kiko}>
        <MenuV2.Item onSelect={() => togglePin(props.id)}>{chat()?.pinned ? "unpin" : "pin"}</MenuV2.Item>
      </Show>
      <MenuV2.Item onSelect={() => toggleMute(props.id)}>{chat()?.muted ? "unmute" : "mute"}</MenuV2.Item>
      <Show when={useApp.chatFaces(props.id).length === 1}>
        <MenuV2.Item onSelect={() => openBirdPicker(useApp.chatFaces(props.id)[0]!)}>change bird</MenuV2.Item>
      </Show>
      <MenuV2.Separator />
      <MenuV2.Item onSelect={() => markUnread(props.id)}>mark as unread</MenuV2.Item>
      <MenuV2.Item onSelect={() => closeChat(props.id, active(), navigate)}>close</MenuV2.Item>
      <Show when={!chat()?.kiko}>
        <MenuV2.Separator />
        {/* Deleting cannot be undone, so the first select arms it and the second deletes, as in the info panel.
            The menu never closes on select: Kobalte reads closeOnSelect after onSelect has armed it, and a
            deleted chat's row takes its menu away with it. */}
        <MenuV2.Item
          class="text-danger hover:bg-[oklch(from_var(--danger)_l_c_h_/_12%)] focus-visible:bg-[oklch(from_var(--danger)_l_c_h_/_12%)]"
          closeOnSelect={false}
          onSelect={() => (sure() ? deleteChat(props.id, active(), navigate) : setSure(true))}
        >
          {sure() ? "sure? delete" : "delete"}
        </MenuV2.Item>
      </Show>
    </>
  )
}

/** The pinned block: a circle, a dot when unread, a name clamped to two lines. */
function PinTile(props: { bot: RosterBot; active: boolean; onSelect: () => void }) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = createSignal(false)
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id)
  return (
    <MenuV2.Context gutter={8} onOpenChange={setMenuOpen}>
      <MenuV2.Context.Trigger as="div" class="pin-tile-slot" data-chat-id={props.bot.id}>
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
            aria-current={props.active ? "true" : undefined}
            onClick={props.onSelect}
          >
            <span class="pin-tile-circle">
              <span class="pin-tile-icon">
                <ChatAvatar faces={useApp.chatFaces(props.bot.id)} class="pin-tile-avatar" />
              </span>
              <Show when={unread()}>
                <span class="pin-tile-dot" aria-hidden="true" />
              </Show>
            </span>
            <span class="pin-tile-name">{props.bot.name}</span>
          </HoverCardV2.Trigger>

          <HoverCardV2.Portal>
            <HoverCardV2.Content>
              <ChatPreview bot={props.bot} />
            </HoverCardV2.Content>
          </HoverCardV2.Portal>
        </HoverCardV2>
      </MenuV2.Context.Trigger>

      <MenuV2.Context.Portal>
        <MenuV2.Context.Content class={menuClass} data-component="sidebar-pin-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <ChatMenuItems id={props.bot.id} />
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

/** The row's hover surface: who this is, and the tail of the conversation. */
function ChatPreview(props: { bot: RosterBot }) {
  const tail = createMemo(() => useApp.messagesFor(props.bot.id).slice(-3))

  return (
    <div class="w-[280px] p-3" data-component="sidebar-preview">
      <div class="flex items-center gap-2.5">
        <ChatAvatar faces={useApp.chatFaces(props.bot.id)} size={32} />
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-text">{props.bot.name}</div>
          <div class="truncate text-[11px] text-weak">{props.bot.presence}</div>
        </div>
      </div>

      <Show when={tail().length > 0}>
        <div class="mt-2.5 flex flex-col gap-1.5">
          <For each={tail()}>
            {(message) => (
              <p class="line-clamp-2 text-[12px] leading-snug text-muted">
                <span class="font-medium text-weak">{message.sender === "user" ? "you" : (useApp.memberById(message.botId)?.name ?? props.bot.name)}</span>{" "}
                {message.body}
              </p>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/** The title, or the field that edits it in place. */
function RowTitle(props: { id: string; title: string }) {
  let input: HTMLInputElement | undefined
  let done = false
  const editing = () => renamingId() === props.id
  createEffect(() => {
    if (!editing()) return
    done = false
    // After the menu has handed focus back, or the field loses it at once.
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
        aria-label="chat name"
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

/**
 * One conversation as kat lays it out: an avatar, a bold title with the time
 * right-aligned on the same line, and a muted one-line preview. The avatar and
 * type sizes are the hover card's, so the two read as one family. The row IS the context menu's trigger,
 * so Kobalte opens it from the real `contextmenu` event on the real element.
 * The hover preview hangs off an overlay, because an element can only be one
 * primitive's trigger.
 */
function ChatRow(props: { bot: RosterBot; muted: boolean; active: boolean; now: number }) {
  /*
   * The preview is nested inside the menu's trigger, so left alone both are
   * open at once, the preview swallows the Escape that would dismiss the menu,
   * and the app stays inert. Declarative, so there is no imperative close to
   * get out of step with Kobalte's own state.
   */
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = createSignal(false)
  const navigate = useNavigate()
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id)
  /** Unsent text in a chat you are not looking at. The open chat shows it in the composer. */
  const draft = () => {
    const book = useApp.drafts()
    // `has` is the reactive read. The text itself only changes in the open chat.
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
          <span class="chat-title-line">
            <RowTitle id={props.bot.id} title={props.bot.name} />
            {/* tweb's mention badge: a round @ beside the unread mark while a mention of you is unread. */}
            <Show when={props.bot.mentions}>
              <i class="chat-mention-badge" data-component="sidebar-mention-badge" role="img" aria-label="you were mentioned">@</i>
            </Show>
            <Show when={unread()}>
              <i class="chat-unread-dot" data-component="sidebar-unread-dot" aria-hidden="true" />
            </Show>
            <span class="chat-time">{rowStamp(props.bot.updatedAt, props.now)}</span>
          </span>

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
                  <span class="chat-draft" data-component="sidebar-draft">draft:</span> {draft()}
                </Show>
              }
            >
              {props.bot.typing ?? "typing"}
              <i class="typing-dot" aria-hidden="true" />
              <i class="typing-dot" aria-hidden="true" />
              <i class="typing-dot" aria-hidden="true" />
            </Show>
          </span>
        </span>
      </MenuV2.Context.Trigger>

      <MenuV2.Context.Portal>
        <MenuV2.Context.Content class={menuClass} data-component="sidebar-chat-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <ChatMenuItems id={props.bot.id} />
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

/** The search field and the filter button. Typing filters locally. */
function SearchRow(props: {
  query: string
  onQuery: (query: string) => void
  unreadOnly: boolean
  onUnreadOnly: (on: boolean) => void
}): JSX.Element {
  return (
    <div class="chat-search" data-component="sidebar-search">
      <label class="chat-search-field">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
        <input
          type="text"
          class="chat-search-input"
          data-component="sidebar-search-input"
          placeholder="search chats"
          aria-label="search chats"
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
      </label>
      <button
        type="button"
        class="chat-filter"
        data-component="sidebar-filter"
        aria-label="show unread only"
        aria-pressed={props.unreadOnly}
        title="unread only"
        onClick={() => props.onUnreadOnly(!props.unreadOnly)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 5H14M2 11H14" /><circle cx="10" cy="5" r="1.6" fill="var(--bg-sidebar)" /><circle cx="6" cy="11" r="1.6" fill="var(--bg-sidebar)" /></svg>
      </button>
    </div>
  )
}

/**
 * The chats panel: search, the pinned tiles (the kiko chat always first), then every conversation
 * in a virtual list. Temporary chats and hidden rooms are left out by `useApp.bots()`. Only the rows in the viewport plus the buffer exist in the DOM.
 *
 * `now` is read once per render rather than from a timer. The stamps are coarse
 * and the list re-renders on every roster change.
 */
export function ChatPanel() {
  const now = Date.now()
  const navigate = useNavigate()
  const [query, setQuery] = createSignal("")
  const [unreadOnly, setUnreadOnly] = createSignal(false)

  const all = createMemo(() => useApp.bots())
  const shown = createMemo(() =>
    filterRows(all(), { query: query(), unreadOnly: unreadOnly() }, (row) => row.unread > 0 || markedUnread(row.id)),
  )
  const pinned = createMemo(() => shown().filter((bot) => bot.pinned))
  const rowIds = createMemo(() => shown().filter((bot) => !bot.pinned).map((bot) => bot.id))
  // Rows are looked up by id so a roster change does not remount the rows that did not change.
  const byId = createMemo(() => new Map(shown().map((bot) => [bot.id, bot])))
  const muted = createMemo(() => new Set((useApp.user()?.chats() ?? []).filter((c) => c.muted).map((c) => c.roomId as string)))
  const active = () => useApp.activeThreadId()

  return (
    <div class="chat-panel" data-component="sidebar-chats">
      <SearchRow query={query()} onQuery={setQuery} unreadOnly={unreadOnly()} onUnreadOnly={setUnreadOnly} />
      <Show when={pinned().length > 0}>
        <div class="pinned-grid">
          <For each={pinned()}>
            {(bot) => (
              <PinTile
                bot={bot}
                active={active() === bot.id}
                onSelect={() => {
                  clearUnreadMark(bot.id)
                  navigate(`/chat/${bot.id}`)
                }}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={shown().length === 0 && (query() !== "" || unreadOnly())}>
        <p class="px-3 py-2 text-xs text-weak" data-component="sidebar-empty">no chats match</p>
      </Show>
      <VList class="chat-list" data={rowIds()} itemSize={ROW_H} bufferSize={ROW_H * 4} data-component="sidebar-list">
        {(id) => (
          <Show when={byId().get(id)}>
            {(bot) => <ChatRow bot={bot()} muted={muted().has(id)} active={active() === id} now={now} />}
          </Show>
        )}
      </VList>
    </div>
  )
}
