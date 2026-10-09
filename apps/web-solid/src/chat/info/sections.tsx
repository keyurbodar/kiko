import type { Chat, Member } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createSignal, type JSX, Show } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { nextAfterClose, openTabs } from "../../app/open-tabs"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import { MemberList } from "../members/members"
import { useApp } from "../../lib/store"
import { pushInfo } from "./state"

/*
 * The parts of the panel, after monocode's Mono details (features/monos/ui/monoPanelParts.tsx and
 * MonoSettingsPage.tsx): a face and a name, a short list of facts, sections under a quiet
 * uppercase label and a hairline, rows that open a page, and the one destructive row at the
 * bottom. Each draws from the stores the app already holds, so opening the panel waits on nothing.
 */

/** The hairline monocode draws between the parts (`border-stroke`). */
export const EDGE = "border-[var(--panel-edge)]"

/**
 * A tab row's arrow keys. Only the selected tab is in the tab order, so ArrowLeft and ArrowRight
 * select the neighbouring tab, wrapping at the ends, and move focus to it.
 */
export function tabKeys<T>(event: KeyboardEvent, tabs: readonly T[], current: T, select: (tab: T) => void) {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
  if (step === 0 || tabs.length === 0) return
  event.preventDefault()
  const next = (tabs.indexOf(current) + step + tabs.length) % tabs.length
  select(tabs[next]!)
  ;(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
}

/** A section: a hairline above, a small uppercase label, and its content. */
export function Card(props: { id: string; title: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class={`border-t ${EDGE} px-2 pt-3 pb-4`} data-component="info-card" data-card={props.id}>
      <div class="flex items-center justify-between px-2 pb-2">
        <h3 class="text-[11px] font-medium tracking-wide text-[color-mix(in_oklab,var(--text)_40%,transparent)] uppercase">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

/** The facts: a label column and a value column, 12px, as monocode lists a Mono's model. */
export function Properties(props: { children: JSX.Element }) {
  return <dl class={`flex flex-col gap-0.5 border-t ${EDGE} px-4 py-3`} data-component="info-properties">{props.children}</dl>
}

export function Property(props: { label: string; field?: string; children: JSX.Element }) {
  return (
    <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start text-[12px]">
      <dt class="flex h-7 items-center text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.label}</dt>
      <dd class="flex min-h-7 min-w-0 items-center truncate text-[color-mix(in_oklab,var(--text)_85%,transparent)]" data-field={props.field}>
        {props.children}
      </dd>
    </div>
  )
}

/** The face and the name at the top of a page. */
export function Profile(props: { face: JSX.Element; children: JSX.Element }) {
  return (
    <header class="flex flex-col items-center gap-2 px-3 pt-6 pb-4 text-center" data-component="info-header">
      {props.face}
      {props.children}
    </header>
  )
}

/** A row that opens a page: its name, a line about it, a count, and a chevron. */
export function NavRow(props: { id: string; label: string; description: string; count?: string | number; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[color-mix(in_oklab,var(--text)_5%,transparent)]"
      data-action={`open-${props.id}`}
      data-card={props.id}
      onClick={() => props.onClick()}
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-[13px] leading-5 text-[color-mix(in_oklab,var(--text)_90%,transparent)]">{props.label}</span>
        <span class="line-clamp-1 text-[12px] leading-5 text-[color-mix(in_oklab,var(--text)_40%,transparent)]">{props.description}</span>
      </span>
      <Show when={props.count !== undefined && props.count !== ""}>
        <span class="shrink-0 text-[12px] leading-5 tabular-nums text-[color-mix(in_oklab,var(--text)_40%,transparent)]">{props.count}</span>
      </Show>
      <span class="shrink-0 text-[color-mix(in_oklab,var(--text)_30%,transparent)]">
        <Chevron />
      </span>
    </button>
  )
}

export function NavRows(props: { children: JSX.Element }) {
  return <nav class={`flex flex-col gap-px border-t ${EDGE} p-2`} data-component="info-rows">{props.children}</nav>
}

/** The destructive row, alone at the bottom: red name, quiet line under it. */
export function DangerRow(props: { action: string; label: string; description: string; onClick: () => void; onBlur?: () => void }) {
  return (
    <div class="mt-auto p-2" data-card="danger">
      <button
        type="button"
        class="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-[color-mix(in_oklab,var(--text)_5%,transparent)]"
        data-action={props.action}
        onClick={() => props.onClick()}
        onBlur={() => props.onBlur?.()}
      >
        <span class="text-[13px] leading-5 text-danger">{props.label}</span>
        <span class="text-[12px] leading-5 text-[color-mix(in_oklab,var(--text)_40%,transparent)]">{props.description}</span>
      </button>
    </div>
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

export function Header(props: { chatId: string }) {
  const [editing, setEditing] = createSignal(false)
  const title = () => chatOf(props.chatId)?.title ?? useApp.chatById(props.chatId)?.name ?? ""
  const commit = (value: string) => {
    setEditing(false)
    const next = value.trim()
    const user = useApp.user()
    if (next && next !== title() && user) user.rename(props.chatId as never, next)
  }
  return (
    <Profile face={<ChatAvatar faces={useApp.chatFaces(props.chatId)} size={56} />}>
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            class="max-w-full truncate rounded-md px-2 py-0.5 text-[15px] font-semibold text-text hover:bg-hover"
            data-component="info-name"
            aria-label="Rename chat"
            onClick={() => setEditing(true)}
          >
            {title() || "New chat"}
          </button>
        }
      >
        <input
          class="h-8 w-full rounded-md bg-input px-3 text-center text-[15px] font-semibold text-text outline-none"
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
    </Profile>
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
    <DangerRow
      action="delete-chat"
      label={sure() ? "Delete chat?" : "Delete chat"}
      description={sure() ? "Click again to delete it for good" : "Remove this chat and its messages"}
      onClick={remove}
      onBlur={() => setSure(false)}
    />
  )
}
