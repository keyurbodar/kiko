import type { Chat, Member } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createSignal, type JSX, Show } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronRightIcon, type Glyph, TrashIcon } from "@kiko/ui/icons"
import { nextAfterClose, openTabs } from "../../app/open-tabs"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import { MemberList } from "../members/members"
import { useApp } from "../../lib/store"
import { subtitle } from "./format"
import { pushInfo } from "./state"

/*
 * The sections on the panel's home view. Each is small and draws from the stores the app
 * already holds, so opening the panel waits on nothing. Sections are not cards: a quiet label
 * and the space around it separate them, as in Claude's and monocode's side panels.
 */

/** A section with a label, and a chevron that opens its full list when it has one. */
export function Card(props: { id: string; title: string; hint?: string; onOpen?: () => void; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-0.5" data-component="info-card" data-card={props.id}>
      <Show
        when={props.onOpen}
        fallback={<h3 class="px-2 pb-1 text-[11px] font-medium tracking-[0.02em] text-faint">{props.title}</h3>}
      >
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md px-2 pb-1 text-[11px] font-medium tracking-[0.02em] text-faint hover:text-text"
          data-action="open-card"
          aria-label={`Open ${props.title}`}
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
  return <HugeIcon icon={ChevronRightIcon} size={14} />
}

/*
 * ASSUMPTION: until teams (P6) a room stores no member record, and its one agent is `kiko` (the
 * server's DEFAULT_AGENT). The sidebar already falls back to that name, so the panel does too.
 */
const DEFAULT_MEMBER = { slug: "kiko" as Member["slug"], name: "Kiko", lead: true }

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
    <header class="flex flex-col items-center gap-1.5 pt-3 pb-2 text-center" data-component="info-header">
      <ChatAvatar faces={useApp.chatFaces(props.chatId)} size={72} />
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class="mt-1 max-w-full truncate rounded-md px-2 py-0.5 text-[15px] font-semibold text-text hover:bg-hover"
            data-component="info-name"
            aria-label="Rename chat"
            onClick={() => setEditing(true)}
          >
            {title() || "New chat"}
          </button>
        }
      >
        <input
          class="mt-1 h-8 w-full rounded-md bg-input px-3 text-center text-[15px] font-semibold text-text outline-none"
          data-component="info-name-input"
          aria-label="Chat name"
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
      <p class="text-xs text-faint" data-component="info-subtitle">
        {subtitle(props.chatId, props.members)}
      </p>
    </header>
  )
}

/** The members card. Its list, with add, rename, and remove, is the group chat's (`chat/members/`). */
export function Members(props: { members: readonly Member[] }) {
  return (
    <Card id="members" title="Members">
      <MemberList members={props.members} onOpen={(slug) => pushInfo({ kind: "agent", slug })} />
    </Card>
  )
}

/** A neutral tile holding a line icon: the row's kind at a glance, without a colour per kind. */
export function Badge(props: { icon: Glyph; danger?: boolean }) {
  return (
    <span
      class="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--tint-subtle)]"
      classList={{ "text-weak": !props.danger, "text-danger": props.danger }}
      aria-hidden="true"
    >
      <HugeIcon icon={props.icon} size={15} />
    </span>
  )
}

/** A row in a grouped list: icon, label, a value or count on the right, and a chevron. */
export function ListRow(props: { id: string; label: string; icon: Glyph; value?: string | number; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-[13px] text-text hover:bg-hover"
      data-action={`open-${props.id}`}
      data-card={props.id}
      onClick={() => props.onClick()}
    >
      <Badge icon={props.icon} />
      <span class="flex-1">{props.label}</span>
      <Show when={props.value !== undefined && props.value !== ""}>
        <span class="max-w-[50%] truncate text-xs tabular-nums text-faint">{props.value}</span>
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
    <div data-card="danger">
      <button
        type="button"
        class="flex h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-[13px] text-danger hover:bg-[var(--danger-wash)]"
        data-action="delete-chat"
        onClick={remove}
        onBlur={() => setSure(false)}
      >
        <Badge icon={TrashIcon} danger />
        {sure() ? "Sure? Delete this chat" : "Delete chat"}
      </button>
    </div>
  )
}
