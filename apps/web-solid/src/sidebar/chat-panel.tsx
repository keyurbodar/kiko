import { Blobatar } from "@blobatar/solid"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useNavigate } from "@solidjs/router"
import { cn } from "../lib/cn"
import { useApp } from "../lib/store"
import type { RosterBot } from "../lib/types"
import { createMemo, createSignal, For, Show } from "solid-js"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The stamp at the end of a row. Relative, not a clock time: `updatedAt` is
 * last activity, and the question a roster answers at a glance is "how stale
 * is this", not "when exactly" — which is also the shape kat prints. Coarse on
 * purpose, so it never needs a ticking timer to stay truthful.
 */
export function rowStamp(updatedAt: number, now: number): string {
  const delta = now - updatedAt
  if (delta < MINUTE) return "now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  return `${Math.floor(delta / DAY)}d`
}

/**
 * A bot's picture. `avatarImage` wins when the fixture carries one; otherwise
 * the blobatar is derived from the name, so every bot has a stable face with
 * nothing to upload. Static, never `animate`: a roster of moving avatars is
 * motion in a place the user is not waiting for anything.
 *
 * Sizing is a utility on the caller, because the two sites differ — 22px in a
 * row, 26px inside a 48px pinned circle.
 */
function RosterAvatar(props: { bot: RosterBot; class: string }) {
  return (
    <span class={props.class}>
      <Show
        when={props.bot.avatarImage}
        fallback={<Blobatar name={props.bot.name} class="size-full rounded-full" />}
      >
        {(src) => <img src={src()} alt="" class="size-full rounded-full object-cover" />}
      </Show>
    </span>
  )
}

/** The pinned block: a circle, a dot when unread, a name clamped to two lines. */
function PinTile(props: { bot: RosterBot; active: boolean; onSelect: () => void }) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = createSignal(false)
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
            data-component="sidebar-pin-tile"
            data-chat-id={props.bot.id}
            data-active={props.active ? "" : undefined}
            data-unread={props.bot.unread > 0 ? "" : undefined}
            aria-current={props.active ? "true" : undefined}
            onClick={props.onSelect}
          >
            <span class="pin-tile-circle">
              <span class="pin-tile-icon">
                <RosterAvatar bot={props.bot} class="pin-tile-avatar" />
              </span>
              <Show when={props.bot.unread > 0}>
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
        <MenuV2.Context.Content
          class={cn(
            "min-w-[180px] rounded-[calc(20px*var(--brm))] p-2",
            "border-none bg-menu text-base text-text shadow-menu",
          )}
          data-component="sidebar-pin-menu"
        >
          <MenuV2.Item onSelect={() => useApp.togglePinned(props.bot.id)}>unpin</MenuV2.Item>
          <MenuV2.Separator />
          <Show
            when={props.bot.unread > 0}
            fallback={
              <MenuV2.Item onSelect={() => useApp.markUnread(props.bot.id)}>mark as unread</MenuV2.Item>
            }
          >
            <MenuV2.Item onSelect={() => useApp.markRead(props.bot.id)}>mark as read</MenuV2.Item>
          </Show>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

/**
 * What trails a row: the unread count, and only that. The typing pulse used to
 * live here and it read as a second, unrelated widget pinned to the right edge;
 * a typing bot is not a badge, so it now replaces the row's preview line where
 * the reader is already looking.
 */
function RowTrailing(props: { bot: RosterBot }) {
  return (
    <span class="chat-trailing">
      <Show when={props.bot.unread > 0}>
        <span
          class={cn(
            "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1",
            "bg-[oklch(from_var(--accent)_l_c_h_/_18%)] text-[11px] font-medium leading-none",
          )}
          data-component="sidebar-unread-count"
        >
          {props.bot.unread}
        </span>
      </Show>
    </span>
  )
}

/** The row's hover surface: who this is, and the tail of the conversation. */
function ChatPreview(props: { bot: RosterBot }) {
  const tail = createMemo(() => useApp.messagesFor(props.bot.id).slice(-3))

  return (
    <div class="w-[280px] p-3" data-component="sidebar-preview">
      <div class="flex items-center gap-2.5">
        <RosterAvatar bot={props.bot} class="size-[32px] shrink-0 rounded-full" />
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-text">{props.bot.name}</div>
          <div class="truncate text-[11px] text-weak">{props.bot.presence}</div>
        </div>
      </div>

      <Show when={props.bot.persona}>
        {(persona) => <p class="mt-2 text-[12px] leading-snug text-weak">{persona()}</p>}
      </Show>

      <Show when={tail().length > 0}>
        <div class="mt-2.5 flex flex-col gap-1.5">
          <For each={tail()}>
            {(message) => (
              <p class="line-clamp-2 text-[12px] leading-snug text-muted">
                <span class="font-medium text-weak">{message.sender === "user" ? "you" : props.bot.name}</span>{" "}
                {message.body}
              </p>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/**
 * One conversation.
 *
 * The row IS the context menu's trigger, so Kobalte opens it from the real
 * `contextmenu` event on the real element — no parked trigger, no event
 * replay, and no id to re-resolve at open time, because each row's menu
 * already closes over its own bot. The hover preview hangs off an overlay
 * instead, because an element can only be one primitive's trigger: the overlay
 * is absolutely positioned, so it stays out of the grid, receives the pointer,
 * and lets the click bubble to the row underneath.
 */
function ChatRow(props: { bot: RosterBot; active: boolean; now: number }) {
  /*
   * The row's preview and its context menu are both floating layers, and the
   * preview is nested inside the menu's trigger. Left alone they are open at
   * the same time — the pointer is on the row, so the preview has opened, and
   * the right-click opens the menu underneath it. The preview's layer is then
   * the topmost one and it swallows the Escape that would dismiss the menu, so
   * the menu stays up and its modality keeps the rest of the page inert: the
   * app is unusable until it is reloaded. Verified before this fix: Escape
   * closed the menu only after the pointer was moved away and the preview had
   * closed on its own.
   *
   * Declarative rather than a call into the hover card, so there is no
   * imperative close to get out of step with Kobalte's own state.
   */
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = createSignal(false)
  const navigate = useNavigate()

  const select = () => {
    navigate(`/chat/${props.bot.id}`)
    useApp.markRead(props.bot.id)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    select()
  }

  return (
    <MenuV2.Context gutter={8} onOpenChange={setMenuOpen}>
      <MenuV2.Context.Trigger
        as="div"
        class="chat-row"
        data-component="sidebar-row"
        data-chat-id={props.bot.id}
        data-active={props.active ? "" : undefined}
        data-unread={props.bot.unread > 0 ? "" : undefined}
        aria-current={props.active ? "true" : undefined}
        role="button"
        tabindex={0}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        <HoverCardV2
          open={previewOpen() && !menuOpen()}
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

        <RosterAvatar bot={props.bot} class="chat-avatar shrink-0" />

        <span class="chat-title-line">
          <span class="chat-name">{props.bot.name}</span>
          <span class="chat-time">{rowStamp(props.bot.updatedAt, props.now)}</span>
        </span>

        <span
          class="chat-preview"
          data-typing={props.bot.presence === "typing" ? "" : undefined}
        >
          <Show when={props.bot.presence === "typing"} fallback={props.bot.preview}>
            typing
            <i class="typing-dot" aria-hidden="true" />
            <i class="typing-dot" aria-hidden="true" />
            <i class="typing-dot" aria-hidden="true" />
          </Show>
        </span>

        <RowTrailing bot={props.bot} />
      </MenuV2.Context.Trigger>

      <MenuV2.Context.Portal>
        <MenuV2.Context.Content
          class={cn(
            "min-w-[180px] rounded-[calc(20px*var(--brm))] p-2",
            "border-none bg-menu text-base text-text shadow-menu",
          )}
          data-component="sidebar-chat-menu"
        >
          <MenuV2.Item onSelect={() => useApp.togglePinned(props.bot.id)}>
            {props.bot.pinned ? "unpin" : "pin"}
          </MenuV2.Item>
          <MenuV2.Separator />
          <Show
            when={props.bot.unread > 0}
            fallback={
              <MenuV2.Item onSelect={() => useApp.markUnread(props.bot.id)}>mark as unread</MenuV2.Item>
            }
          >
            <MenuV2.Item onSelect={() => useApp.markRead(props.bot.id)}>mark as read</MenuV2.Item>
          </Show>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

/**
 * The chats panel: the pinned block, then every conversation.
 *
 * `now` is read once per render rather than from a timer. The stamps are coarse
 * (minutes upward) and the list re-renders on every roster change, so a clock
 * would buy a repaint per minute and nothing else.
 */
export function ChatPanel() {
  const now = Date.now()
  const navigate = useNavigate()
  const pinned = createMemo(() => useApp.bots().filter((bot) => bot.pinned))
  const rows = createMemo(() => useApp.bots().filter((bot) => !bot.pinned))
  return (
    <div class="flex flex-col" data-component="sidebar-chats">
      <Show when={pinned().length > 0}>
        <div class="pinned-grid">
          <For each={pinned()}>
            {(bot) => (
              <PinTile
                bot={bot}
                active={useApp.activeThreadId() === bot.id}
                onSelect={() => {
                  navigate(`/chat/${bot.id}`)
                  useApp.markRead(bot.id)
                }}
              />
            )}
          </For>
        </div>
      </Show>
      <div class="chat-list" role="list">
        <For each={rows()}>
          {(bot) => <ChatRow bot={bot} active={useApp.activeThreadId() === bot.id} now={now} />}
        </For>
      </div>
    </div>
  )
}
