import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, MuteIcon, PlusIcon, SlidersIcon } from "@kiko/ui/icons"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { openAvatarPicker } from "../avatar/picker-state"
import { openChat } from "../app/history"
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import { runCommand } from "../commands/registry"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { agentDisplayName } from "../lib/names"
import { cachedTail, room } from "../state/room"
import { user } from "../state/user"
import { draftBook } from "../composer/draft-book"
import type { BotPresence, ChatMessage, RosterBot } from "../lib/types"
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
import { flipRows } from "./flip"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const SKELETON_ROWS = [62, 48, 70, 54, 66, 44]
const isLive = (bot: RosterBot) => bot.presence === "working" || bot.presence === "typing"

function rowStamp(updatedAt: number, now: number): string {
  const delta = now - updatedAt
  if (delta < MINUTE) return "now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`
  return `${Math.floor(delta / DAY)}d`
}

const PRESENCE: Record<BotPresence, string> = {
  idle: "Idle",
  typing: "Typing",
  working: "Working",
  sleeping: "Sleeping",
}

function ChatMenuItems(props: { id: string }) {
  const chat = createMemo(() => user.chats().find((c) => c.roomId === props.id))
  const active = () => room.activeId()
  const [sure, setSure] = createSignal(false)
  return (
    <>
      <MenuV2.Item onSelect={() => startRename(props.id)} shortcut="F2">
        Rename
      </MenuV2.Item>

      <Show when={!chat()?.kiko} fallback={<MenuV2.Item disabled>Always pinned</MenuV2.Item>}>
        <MenuV2.Item onSelect={() => togglePin(props.id)}>{chat()?.pinned ? "Unpin" : "Pin"}</MenuV2.Item>
      </Show>
      <MenuV2.Item onSelect={() => toggleMute(props.id)}>{chat()?.muted ? "Unmute" : "Mute"}</MenuV2.Item>
      <Show when={room.chatFaces(props.id).length === 1}>
        <MenuV2.Item onSelect={() => openAvatarPicker(room.chatFaces(props.id)[0]!)}>Change avatar</MenuV2.Item>
      </Show>
      <MenuV2.Separator />
      <MenuV2.Item onSelect={() => markUnread(props.id)}>Mark as unread</MenuV2.Item>
      <MenuV2.Item onSelect={() => closeChat(props.id, active())}>Close</MenuV2.Item>
      <MenuV2.Separator />
      <Show when={!chat()?.kiko} fallback={<MenuV2.Item disabled>Kiko can't be deleted</MenuV2.Item>}>
        <MenuV2.Item
          class="text-bad"
          closeOnSelect={false}
          onSelect={() => (sure() ? deleteChat(props.id, active()) : setSure(true))}
        >
          {sure() ? "Delete chat?" : "Delete"}
        </MenuV2.Item>
      </Show>
    </>
  )
}

const [openPreview, setOpenPreview] = createSignal<string | null>(null)

if (typeof document !== "undefined") {
  const close = () => setOpenPreview(null)
  document.addEventListener("pointerdown", close, true)
  document.addEventListener(
    "keydown",
    (event) => {
      if (!["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) close()
    },
    true,
  )
}

function previewState(id: string) {
  const open = () => openPreview() === id
  const set = (on: boolean) => {
    if (on) setOpenPreview(id)
    else if (open()) setOpenPreview(null)
  }
  return [open, set] as const
}

function ChatPreview(props: { bot: RosterBot }) {
  const cached = cachedTail(
    () => props.bot.id,
    () => true,
  )
  const tail = createMemo(() => {
    const live = room.activeId() === props.bot.id ? room.messages() : cached()
    return live.filter(isListed).slice(-3)
  })
  const name = (slug: string) => agentDisplayName(slug, user.agents())
  const speaker = (message: ChatMessage) =>
    message.sender === "user"
      ? "You"
      : message.botId === undefined
        ? props.bot.name
        : agentDisplayName(message.botId, user.agents())

  return (
    <div class="w-[280px] p-3" data-component="sidebar-preview">
      <div class="flex items-center gap-2.5">
        <ChatAvatar faces={room.chatFaces(props.bot.id)} size={32} />
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-fg">{props.bot.name}</div>
          <div class="truncate text-[11px] text-fg3">{PRESENCE[props.bot.presence]}</div>
        </div>
      </div>

      <Show when={tail().length > 0}>
        <div class="mt-2.5 flex flex-col gap-1.5">
          <For each={tail()}>
            {(message) => (
              <p class="line-clamp-2 text-[12px] leading-snug text-fg3">
                <span class="font-semibold text-fg">{speaker(message)}:</span> {quoteOf(message, name)}
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
  onCleanup(() => {
    if (done || !editing()) return
    done = true
    const value = input?.value ?? props.title
    commitRename(props.id, value)
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

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])

function ChatRow(props: {
  bot: RosterBot
  muted: boolean
  active: boolean
  now: number
  hint?: string
  main?: boolean
  enter?: boolean
}) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = previewState(props.bot.id)
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id)
  const live = () => isLive(props.bot)
  const draft = () => {
    const book = draftBook()
    return props.active || !book?.has(props.bot.id) ? "" : (book.get(props.bot.id)?.text.trim() ?? "")
  }

  const select = () => {
    clearUnreadMark(props.bot.id)
    openChat(props.bot.id)
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
        data-component="sidebar-row"
        data-main={props.main ? "" : undefined}
        data-pinned={props.bot.pinned ? "" : undefined}
        data-chat-id={props.bot.id}
        data-hint={props.hint}
        data-hint-label="Chat"
        data-hint-side="right"
        data-active={props.active ? "" : undefined}
        data-unread={unread() ? "" : undefined}
        data-draft={draft() ? "" : undefined}
        data-muted={props.muted ? "" : undefined}
        data-live={live() ? "" : undefined}
        data-enter={props.enter ? "" : undefined}
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

        <span class="chat-avatar" data-faces={room.chatFaces(props.bot.id).length}>
          <ChatAvatar faces={room.chatFaces(props.bot.id)} size={room.chatFaces(props.bot.id).length > 1 ? 26 : 25} />
        </span>

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
              data-live={live() ? "" : undefined}
              data-empty={!props.bot.preview && !draft() && !live() ? "" : undefined}
            >
              <Show
                when={live()}
                fallback={
                  <Show
                    when={draft()}
                    fallback={
                      <>
                        <Show when={props.bot.previewFrom}>
                          <span class="chat-preview-from" data-component="sidebar-preview-from">
                            {props.bot.previewFrom}:
                          </span>{" "}
                        </Show>
                        {props.bot.preview}
                      </>
                    }
                  >
                    <span class="chat-draft" data-component="sidebar-draft">
                      Draft:
                    </span>{" "}
                    {draft()}
                  </Show>
                }
              >
                <span class="chat-shimmer">
                  {props.bot.typing ?? (props.bot.presence === "typing" ? "Typing" : "Working")}
                </span>
              </Show>
            </span>
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

function SectionLabel(props: {
  label: string
  open: boolean
  onToggle: () => void
  children?: JSX.Element
}): JSX.Element {
  return (
    <div class="chat-section" data-component="sidebar-section-label">
      <button
        type="button"
        class="chat-section-toggle"
        aria-expanded={props.open}
        data-open={props.open ? "" : undefined}
        onClick={props.onToggle}
      >
        {props.label}
        <RemixIcon icon={ChevronDownIcon} size={11} class="chat-section-chevron" />
      </button>
      <span class="chat-section-actions">{props.children}</span>
    </div>
  )
}

function Fold(props: { open: boolean; children: JSX.Element }): JSX.Element {
  return (
    <div class="chat-fold" data-open={props.open ? "" : undefined} inert={!props.open}>
      <div class="chat-fold-inner">{props.children}</div>
    </div>
  )
}

export function ChatPanel() {
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(clock))
  const [unreadOnly, setUnreadOnly] = createSignal(false)
  const [workingOpen, setWorkingOpen] = createSignal(true)
  const [chatsOpen, setChatsOpen] = createSignal(true)
  const [settled, setSettled] = createSignal(false)
  onMount(() => requestAnimationFrame(() => setSettled(true)))

  const all = createMemo(() => room.bots())
  const shown = createMemo(() =>
    filterRows(all(), { query: "", unreadOnly: unreadOnly() }, (row) => row.unread > 0 || markedUnread(row.id)),
  )
  const working = createMemo(() => shown().filter(isLive))
  const idle = createMemo(() => {
    const rest = shown().filter((bot) => !isLive(bot))
    return [...pinnedRows(rest, user.kikoChatId()), ...rest.filter((bot) => !bot.pinned)]
  })
  const workingIds = createMemo(() => working().map((bot) => bot.id), undefined, { equals: sameIds })
  const idleIds = createMemo(() => idle().map((bot) => bot.id), undefined, { equals: sameIds })
  const jumpHint = createMemo(() => {
    if (unreadOnly()) return new Map<string, string>()
    const order = [...all().filter((b) => b.pinned), ...all().filter((b) => !b.pinned)].slice(0, 9)
    return new Map(order.map((b, i) => [b.id, `chats.go-${i + 1}`]))
  })
  const byId = createMemo(() => new Map(shown().map((bot) => [bot.id, bot])))
  const muted = createMemo(() => new Set((user.chats() ?? []).filter((c) => c.muted).map((c) => c.roomId as string)))
  const active = () => room.activeId()
  const loading = () => all().length === 0 && !!user.loaded() && !user.synced()
  let scroller: HTMLDivElement | undefined
  flipRows(
    () => scroller,
    () => [...workingIds(), "|", ...idleIds()],
  )

  const rows = (ids: () => readonly string[]) => (
    <For each={ids()}>
      {(id) => (
        <Show when={byId().get(id)}>
          {(bot) => (
            <ChatRow
              bot={bot()}
              hint={jumpHint().get(id)}
              active={active() === id}
              main={id === user.kikoChatId()}
              muted={muted().has(id)}
              now={now()}
              enter={settled()}
            />
          )}
        </Show>
      )}
    </For>
  )

  return (
    <div class="chat-panel" data-component="sidebar-chats">
      <div class="chat-scroll" data-component="sidebar-list" ref={(el) => (scroller = el)}>
        <Show when={working().length > 0}>
          <SectionLabel label="Working" open={workingOpen()} onToggle={() => setWorkingOpen(!workingOpen())} />
          <Fold open={workingOpen()}>{rows(workingIds)}</Fold>
        </Show>
        <SectionLabel label="Chats" open={chatsOpen()} onToggle={() => setChatsOpen(!chatsOpen())}>
          <TooltipV2 placement="bottom" openDelay={400} value="New chat">
            <button
              type="button"
              class="chat-section-button"
              data-component="sidebar-chats-new"
              aria-label="New chat"
              onClick={() => runCommand("chat.new")}
            >
              <RemixIcon icon={PlusIcon} size={15} />
            </button>
          </TooltipV2>
          <TooltipV2 placement="bottom" openDelay={400} value="Unread only">
            <button
              type="button"
              class="chat-section-button"
              data-component="sidebar-filter"
              aria-label="Show unread only"
              aria-pressed={unreadOnly()}
              onClick={() => setUnreadOnly(!unreadOnly())}
            >
              <RemixIcon icon={SlidersIcon} size={15} />
            </button>
          </TooltipV2>
        </SectionLabel>
        <Show when={shown().length === 0 && unreadOnly()}>
          <div class="chat-empty" data-component="sidebar-empty">
            No unread chats
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
        <Fold open={chatsOpen()}>{rows(idleIds)}</Fold>
      </div>
    </div>
  )
}
