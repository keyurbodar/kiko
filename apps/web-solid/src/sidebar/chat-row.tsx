import { RemixIcon } from "@kiko/ui/remix-icon"
import { MoreIcon, MuteIcon, PinFillIcon } from "@kiko/ui/icons"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { openAvatarPicker } from "../avatar/picker-state"
import { openChat } from "../app/history"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Mochi } from "../chat/ui/Mochi"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { agentDisplayName } from "../lib/names"
import { presenceWords } from "../state/live-status"
import { cachedTail, room } from "../state/room"
import { user } from "../state/user"
import { draftBook } from "../composer/draft-book"
import type { ChatMessage, RosterBot } from "../lib/types"
import {
  cancelRename,
  clearUnreadMark,
  closeChat,
  commitRename,
  deleteChat,
  isLeaving,
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

function ChatMenuItems(props: { id: string }) {
  const chat = createMemo(() => user.chats().find((c) => c.roomId === props.id))
  const active = () => room.activeId()
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
        <MenuV2.Item class="text-bad" data-action="delete-chat" onSelect={() => deleteChat(props.id, active())}>
          <span class="text-bad">Delete</span>
        </MenuV2.Item>
      </Show>
    </>
  )
}

const [openPreview, setOpenPreview] = createSignal<string | null>(null)
let previewClosedAt = 0
const HANDOFF_MS = 400
const fine = () => typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches

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
    else if (open()) {
      previewClosedAt = performance.now()
      setOpenPreview(null)
    }
  }
  const delay = () => (openPreview() !== null || performance.now() - previewClosedAt < HANDOFF_MS ? 0 : 500)
  return [open, set, delay] as const
}

function ChatPreview(props: { bot: RosterBot; tail: readonly ChatMessage[] }) {
  const name = (slug: string) => agentDisplayName(slug, user.agents())
  const speaker = (message: ChatMessage) =>
    message.sender === "user"
      ? "You"
      : message.botId === undefined
        ? props.bot.name
        : agentDisplayName(message.botId, user.agents())

  return (
    <div class="flex w-[280px] flex-col gap-1.5 p-3" data-component="sidebar-preview">
      <For each={props.tail}>
        {(message) => (
          <p class="type-label line-clamp-2 text-fg3">
            <span class="font-semibold text-fg">{speaker(message)}:</span> {quoteOf(message, name)}
          </p>
        )}
      </For>
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

function MentionText(props: { text: string; mentioned: boolean }) {
  const parts = () => (props.mentioned ? props.text.split(/(@[\w-]+)/) : [props.text])
  return (
    <For each={parts()}>
      {(part) => (part.startsWith("@") && props.mentioned ? <span class="chat-mention">{part}</span> : part)}
    </For>
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
                  <MentionText text={props.bot.preview} mentioned={(props.bot.mentions ?? 0) > 0} />
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
            {props.bot.typing ?? presenceWords(props.bot.presence === "working" ? "working" : "typing")}
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

function RowBody(props: {
  bot: RosterBot
  now: number
  muted: boolean
  pinMark?: boolean
  enter?: boolean
  need?: Need
  draft: string
  unread: boolean
}) {
  const [pinBounce, setPinBounce] = createSignal(props.enter === true)
  const live = () => isLive(props.bot)
  const faces = () => room.chatFaces(props.bot.id)
  return (
    <>
      <span class="chat-avatar" data-faces={faces().length}>
        <ChatAvatar faces={faces()} size={32} />
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
            data-empty={!props.bot.preview && !props.draft && !live() && !props.need ? "" : undefined}
          >
            <RowPreview bot={props.bot} need={props.need} live={live()} draft={props.draft} />
          </span>
          <Show when={props.unread}>
            <span class="chat-dot" data-component="sidebar-unread-dot" aria-hidden="true" />
          </Show>
        </span>
      </span>
    </>
  )
}

function RowMore(props: { id: string; name: string; onOpenChange: (open: boolean) => void }) {
  return (
    <MenuV2 gutter={4} placement="bottom-start" onOpenChange={props.onOpenChange}>
      <MenuV2.Trigger class="chat-more" data-action="chat-row-menu" aria-label={`More for ${props.name}`}>
        <RemixIcon icon={MoreIcon} size={16} />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content data-component="sidebar-chat-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <ChatMenuItems id={props.id} />
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

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
  const [contextOpen, setContextOpen] = createSignal(false)
  const [moreOpen, setMoreOpen] = createSignal(false)
  const menuOpen = () => contextOpen() || moreOpen()
  const [previewOpen, setPreviewOpen, previewDelay] = previewState(props.bot.id)
  const [hovered, setHovered] = createSignal(false)
  const tail = cachedTail(() => props.bot.id, hovered)
  const recent = createMemo(() => {
    const live = room.activeId() === props.bot.id ? room.messages() : tail()
    return live.filter(isListed).slice(-3)
  })
  const unread = () => props.bot.unread > 0 || markedUnread(props.bot.id) || props.need !== undefined
  const draft = () => {
    const book = draftBook()
    return props.active || !book?.has(props.bot.id) ? "" : (book.get(props.bot.id)?.text.trim() ?? "")
  }
  const onClick = (event: MouseEvent) => {
    if (!plainClick(event)) return
    event.preventDefault()
    clearUnreadMark(props.bot.id)
    openChat(props.bot.id)
  }

  return (
    <MenuV2.Context gutter={8} onOpenChange={setContextOpen}>
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
        data-live={isLive(props.bot) ? "" : undefined}
        data-need={props.need?.kind}
        data-enter={props.enter ? "" : undefined}
        data-menu-open={menuOpen() ? "" : undefined}
        data-leaving={isLeaving(props.bot.id) ? "" : undefined}
        onPointerEnter={(event: PointerEvent) => event.pointerType === "mouse" && setHovered(true)}
      >
        <HoverCardV2
          open={fine() && previewOpen() && recent().length > 0 && !menuOpen() && renamingId() !== props.bot.id}
          onOpenChange={setPreviewOpen}
          openDelay={previewDelay()}
          closeDelay={120}
          placement="right-start"
          gutter={8}
          getAnchorRect={(anchor) => anchor?.parentElement?.getBoundingClientRect()}
        >
          <HoverCardV2.Trigger
            class="chat-link"
            href={`/chat/${encodeURIComponent(props.bot.id)}`}
            aria-current={props.active ? "page" : undefined}
            aria-label={props.bot.name}
            onClick={onClick}
          />
          <HoverCardV2.Portal>
            <HoverCardV2.Content>
              <ChatPreview bot={props.bot} tail={recent()} />
            </HoverCardV2.Content>
          </HoverCardV2.Portal>
        </HoverCardV2>

        <RowBody
          bot={props.bot}
          now={props.now}
          muted={props.muted}
          pinMark={props.pinMark}
          enter={props.enter}
          need={props.need}
          draft={draft()}
          unread={unread()}
        />
        <RowMore id={props.bot.id} name={props.bot.name} onOpenChange={setMoreOpen} />
      </MenuV2.Context.Trigger>

      <MenuV2.Context.Portal>
        <MenuV2.Context.Content data-component="sidebar-chat-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <ChatMenuItems id={props.bot.id} />
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}
