import { RemixIcon } from "@kiko/ui/remix-icon"
import { MuteIcon, PinFillIcon } from "@kiko/ui/icons"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { openAvatarPicker } from "../avatar/picker-state"
import { openChat } from "../app/history"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Mochi } from "../chat/ui/Mochi"
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
import type { Need } from "./needs"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const isLive = (bot: RosterBot) => bot.presence === "working" || bot.presence === "typing"

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

function RowPreview(props: { bot: RosterBot; need: Need | undefined; live: boolean; draft: string }) {
  return (
    <Show
      when={props.need}
      fallback={
        <Show
          when={props.live}
          fallback={
            <Show
              when={props.draft}
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
              {props.draft}
            </Show>
          }
        >
          <Mochi size={12} class="chat-mochi" />
          <span class="chat-shimmer">
            {props.bot.typing ?? (props.bot.presence === "typing" ? "Typing" : "Working")}
          </span>
        </Show>
      }
    >
      {(need) => (
        <>
          <span data-component="sidebar-need-text">{need().text}</span>
          <Show when={need().retry}>
            {(retry) => (
              <>
                {" "}
                <button
                  type="button"
                  class="chat-retry"
                  data-action="retry-run"
                  onClick={(event) => {
                    event.stopPropagation()
                    retry()()
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  Retry
                </button>
              </>
            )}
          </Show>
        </>
      )}
    </Show>
  )
}

export function ChatRow(props: {
  bot: RosterBot
  muted: boolean
  active: boolean
  now: number
  hint?: string
  main?: boolean
  enter?: boolean
  need?: Need
  pinMark?: boolean
}) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [previewOpen, setPreviewOpen] = previewState(props.bot.id)
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id) || props.need !== undefined
  const [pinBounce, setPinBounce] = createSignal(props.enter === true)
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
        data-need={props.need?.kind}
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
            <Show when={props.pinMark && props.bot.pinned}>
              <RemixIcon
                icon={PinFillIcon}
                size={11}
                class="chat-pin-icon"
                data-bounce={pinBounce() ? "" : undefined}
                onAnimationEnd={() => setPinBounce(false)}
              />
            </Show>
            <Show when={props.muted}>
              <RemixIcon icon={MuteIcon} size={12} class="chat-muted-icon" />
            </Show>
            <span class="chat-time">{rowStamp(props.bot.updatedAt, props.now)}</span>
          </span>

          <span class="chat-line">
            <span
              class="chat-preview"
              data-live={live() ? "" : undefined}
              data-empty={!props.bot.preview && !draft() && !live() && !props.need ? "" : undefined}
            >
              <RowPreview bot={props.bot} need={props.need} live={live()} draft={draft()} />
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
