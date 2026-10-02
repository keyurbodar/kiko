import type { Chat, Member } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, type JSX, Show } from "solid-js"
import { nextAfterClose, openTabs } from "../../app/open-tabs"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import { MemberList } from "../members/members"
import { useApp } from "../../lib/store"
import { subtitle } from "./format"
import { pushInfo, setInfoTab } from "./state"

/*
 * The cards on the panel's home view. Each is small and draws from the stores the app
 * already holds, so opening the panel waits on nothing.
 */

export const flat = "rounded-xl bg-bg-subtle"
const rowButton = "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-text hover:bg-nav-hover"

/** A card with a title and a chevron that opens its full list. */
export function Card(props: { id: string; title: string; hint?: string; onOpen?: () => void; children: JSX.Element }) {
  return (
    <section class={`${flat} p-2`} data-component="info-card" data-card={props.id}>
      <Show
        when={props.onOpen}
        fallback={<h3 class="px-2 pt-1 pb-1 text-xs text-weak">{props.title}</h3>}
      >
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg px-2 pt-1 pb-1 text-xs text-weak hover:text-text"
          data-action="open-card"
          aria-label={`open ${props.title}`}
          onClick={() => props.onOpen?.()}
        >
          <span>{props.title}</span>
          <span class="flex items-center gap-1">
            <Show when={props.hint}>
              <span data-component="info-card-hint">{props.hint}</span>
            </Show>
            <Chevron />
          </span>
        </button>
      </Show>
      {props.children}
    </section>
  )
}

export function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4.5 2.5L8 6l-3.5 3.5" />
    </svg>
  )
}

/*
 * ASSUMPTION: until teams (P6) a room stores no member record, and its one agent is `kiko` (the
 * server's DEFAULT_AGENT). The sidebar already falls back to that name, so the panel does too.
 */
const DEFAULT_MEMBER = { slug: "kiko" as Member["slug"], name: "kiko", lead: true }

/** The open room's agents with pending changes applied, or the one default agent while the room lists none. */
export function roomMembers(): readonly Member[] {
  const members = useApp.roomMembers()
  return members.length ? members : [DEFAULT_MEMBER]
}

/** The chat as the user list holds it. Undefined until the list loads or when the chat is gone. */
export function chatOf(chatId: string): Chat | undefined {
  return useApp.user()?.chats().find((c) => c.roomId === chatId)
}

export function Header(props: { chatId: string; members: readonly Member[] }) {
  const [editing, setEditing] = createSignal(false)
  const title = () => chatOf(props.chatId)?.title ?? useApp.chatById(props.chatId)?.name ?? ""
  const commit = (value: string) => {
    setEditing(false)
    const next = value.trim()
    const user = useApp.user()
    if (next && next !== title() && user) user.rename(props.chatId as never, next)
  }
  return (
    <header class="flex flex-col items-center gap-2 pt-2 pb-1 text-center" data-component="info-header">
      <ChatAvatar faces={useApp.chatFaces(props.chatId)} size={96} />
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class="max-w-full truncate rounded-lg px-2 py-0.5 text-lg font-medium text-text hover:bg-nav-hover"
            data-component="info-name"
            aria-label="rename chat"
            onClick={() => setEditing(true)}
          >
            {title() || "new chat"}
          </button>
        }
      >
        <input
          class="h-9 w-full rounded-lg bg-input px-3 text-center text-lg text-text outline-none"
          data-component="info-name-input"
          aria-label="chat name"
          value={title()}
          ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            else if (e.key === "Escape") {
              // Escape cancels the edit and nothing else.
              e.stopPropagation()
              setEditing(false)
            }
          }}
        />
      </Show>
      <p class="text-sm text-weak" data-component="info-subtitle">
        {subtitle(props.chatId, props.members)}
      </p>
    </header>
  )
}

/** The members card. Its list, with add, rename, and remove, is the group chat's (`chat/members/`). */
export function Members(props: { members: readonly Member[] }) {
  return (
    <Card id="members" title="members">
      <MemberList members={props.members} onOpen={(slug) => pushInfo({ kind: "agent", slug })} />
    </Card>
  )
}

/** A colored circle with a line icon. The hue sets the color, so each kind of row reads at a glance. */
export function Badge(props: { hue: number; path: string; size?: number }) {
  const size = () => props.size ?? 30
  return (
    <span
      class="grid shrink-0 place-items-center rounded-full"
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        background: `oklch(0.62 0.13 ${props.hue} / 0.2)`,
        color: `oklch(0.8 0.13 ${props.hue})`,
      }}
      aria-hidden="true"
    >
      <svg width={size() / 2} height={size() / 2} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d={props.path} />
      </svg>
    </span>
  )
}

export const ICON = {
  mute: "M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 6l3 4M14 6l-3 4",
  unmute: "M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5",
  pin: "M10.5 1.5l4 4-2 1-2.5 2.5.5 3-1.5 1.5-7-7L3.5 5l3 .5L9 2.5zM5 11l-3.5 3.5",
  memory: "M8 2.5c-2.5 0-4.5 1.8-4.5 4.2 0 1.4.7 2.5 1.7 3.3V12h5.6v-2c1-.8 1.7-1.9 1.7-3.3 0-2.4-2-4.2-4.5-4.2zM6 14h4",
  model: "M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z",
  links: "M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.7.7M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.7-.7",
  media: "M2 3.5h12v9H2zM2 10.5l3.5-3 3 2.5 2-1.5 3.5 3M10.5 6.5h.01",
  files: "M4 1.5h5l3 3v10H4zM9 1.5v3h3",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9",
} as const

/** One round action under the header, Telegram style. */
export function QuickAction(props: { id: string; label: string; path: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl bg-bg-subtle px-1 py-2.5 text-xs text-weak hover:bg-nav-hover hover:text-text aria-pressed:text-accent"
      data-action={props.id}
      aria-pressed={props.active}
      onClick={() => props.onClick()}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={props.path} />
      </svg>
      <span class="truncate">{props.label}</span>
    </button>
  )
}

/** Mute, pin, memory, files: the actions people reach for, one click each. */
export function QuickActions(props: { chatId: string }) {
  const chat = () => chatOf(props.chatId)
  const muted = () => chat()?.muted ?? false
  const pinned = () => chat()?.pinned ?? false
  return (
    <div class="flex gap-2" data-component="info-actions">
      <QuickAction id="mute" label={muted() ? "unmute" : "mute"} path={muted() ? ICON.mute : ICON.unmute} active={muted()} onClick={() => useApp.user()?.mute(props.chatId as never, !muted())} />
      <QuickAction id="pin" label={pinned() ? "unpin" : "pin"} path={ICON.pin} active={pinned()} onClick={() => useApp.user()?.pin(props.chatId as never, !pinned())} />
      <QuickAction id="memory" label="memory" path={ICON.memory} onClick={() => pushInfo({ kind: "memory" })} />
      <QuickAction id="files" label="files" path={ICON.files} onClick={() => setInfoTab("files")} />
    </div>
  )
}

/** A row in a grouped list: badge, label, a value or count on the right, and a chevron. */
export function ListRow(props: { id: string; label: string; hue: number; path: string; value?: string | number; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[15px] text-text hover:bg-nav-hover"
      data-action={`open-${props.id}`}
      data-card={props.id}
      onClick={() => props.onClick()}
    >
      <Badge hue={props.hue} path={props.path} />
      <span class="flex-1">{props.label}</span>
      <Show when={props.value !== undefined && props.value !== ""}>
        <span class="max-w-[50%] truncate text-sm text-weak">{props.value}</span>
      </Show>
      <span class="text-faint">
        <Chevron />
      </span>
    </button>
  )
}

/** Delete chat on its own, in red. Asks once. */
export function DeleteChat(props: { chatId: string }) {
  const navigate = useNavigate()
  const [sure, setSure] = createSignal(false)
  const remove = () => {
    if (!sure()) return setSure(true)
    const next = nextAfterClose(openTabs.ids(), props.chatId, props.chatId)
    openTabs.close(props.chatId)
    useApp.user()?.remove(props.chatId as never)
    navigate(next ? `/chat/${next}` : "/chat")
  }
  return (
    <div class={`${flat} p-1`} data-card="danger">
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[15px] text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))] hover:bg-nav-hover"
        data-action="delete-chat"
        onClick={remove}
        onBlur={() => setSure(false)}
      >
        <Badge hue={25} path={ICON.trash} />
        {sure() ? "sure? delete this chat" : "delete chat"}
      </button>
    </div>
  )
}
