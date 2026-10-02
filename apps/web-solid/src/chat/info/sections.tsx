import type { Chat, Member } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createSignal, For, type JSX, Show } from "solid-js"
import { nextAfterClose, openTabs } from "../../app/open-tabs"
import { session } from "../../app/session"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { chatModel } from "../../settings/chat-model"
import { subtitle } from "./format"
import { pushInfo } from "./state"

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

function Crown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-label="you" data-component="info-crown">
      <path d="M1 3.5l2.5 2L6 2l2.5 3.5 2.5-2L10 9H2z" />
    </svg>
  )
}

/*
 * ASSUMPTION: until teams (P6) a room stores no member record, and its one agent is `kiko` (the
 * server's DEFAULT_AGENT). The sidebar already falls back to that name, so the panel does too.
 */
const DEFAULT_MEMBER = { slug: "kiko" as Member["slug"], name: "kiko", lead: true }

/** The open room's agents, or the one default agent while the room lists none. */
export function roomMembers(): readonly Member[] {
  const members = useApp.room()?.state.members ?? []
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
      <IdentityAvatar seed={props.chatId} size={96} />
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

export function Members(props: { members: readonly Member[] }) {
  const me = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <Card id="members" title="members">
      <ul class="flex flex-col" data-component="info-members">
        <li>
          <div class={rowButton} data-member="human">
            <IdentityAvatar seed={me()?.id ?? "you"} size={32} />
            <span class="min-w-0 flex-1 truncate">{(me()?.name ?? "you").toLowerCase()}</span>
            <span class="text-weak">
              <Crown />
            </span>
          </div>
        </li>
        <For each={props.members}>
          {(m) => (
            <li>
              <button type="button" class={rowButton} data-member={m.slug} onClick={() => pushInfo({ kind: "agent", slug: m.slug })}>
                <IdentityAvatar seed={m.slug} size={32} />
                <span class="min-w-0 flex-1 truncate">{m.name}</span>
                <span class="text-xs text-weak">{m.lead ? "lead" : "agent"}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
      {/* ASSUMPTION: the room has no add-agent frame until teams (P6-08), so the button waits. */}
      <button
        type="button"
        class={`${rowButton} text-weak disabled:opacity-50`}
        data-action="add-agent"
        disabled
        title="agents can be added once teams land"
      >
        <span class="grid size-8 place-items-center rounded-full bg-btn text-base">+</span>
        add
      </button>
    </Card>
  )
}

/** The model this chat uses. A card that opens the model list. */
export function ModelCard(props: { chatId: string }) {
  const model = () => chatModel(props.chatId)
  return (
    <Card id="model" title="model" onOpen={() => pushInfo({ kind: "model" })}>
      <p class="truncate px-2 py-1.5 text-sm text-text" data-component="info-model">
        {model()?.split("/").slice(1).join("/") ?? "no model chosen"}
      </p>
    </Card>
  )
}

function Toggle(props: { label: string; on: boolean; onToggle: () => void; id: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      class={rowButton}
      data-toggle={props.id}
      onClick={() => props.onToggle()}
    >
      <span class="flex-1">{props.label}</span>
      <span
        class="relative h-5 w-9 rounded-full bg-btn data-[on]:bg-[var(--accent)]"
        data-on={props.on ? "" : undefined}
        aria-hidden="true"
      >
        <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white data-[on]:left-[18px]" data-on={props.on ? "" : undefined} />
      </span>
    </button>
  )
}

/** Mute and pin. Both apply to the chat list at once. Lock is left out: kiko has no per-chat lock. */
export function Toggles(props: { chatId: string }) {
  const chat = () => chatOf(props.chatId)
  return (
    <Card id="toggles" title="chat">
      <Toggle id="mute" label="mute" on={chat()?.muted ?? false} onToggle={() => useApp.user()?.mute(props.chatId as never, !chat()?.muted)} />
      <Toggle id="pin" label="pin" on={chat()?.pinned ?? false} onToggle={() => useApp.user()?.pin(props.chatId as never, !chat()?.pinned)} />
    </Card>
  )
}

export function Danger(props: { chatId: string }) {
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
    <Card id="danger" title="danger zone">
      {/* ASSUMPTION: export waits for P8-09, and the room has no clear-history frame yet. */}
      <button type="button" class={`${rowButton} disabled:opacity-50`} data-action="export" disabled title="export arrives with chat export">
        export as markdown
      </button>
      <button type="button" class={`${rowButton} disabled:opacity-50`} data-action="clear" disabled title="clearing history is not built yet">
        clear history
      </button>
      <button type="button" class={`${rowButton} text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))]`} data-action="delete-chat" onClick={remove} onBlur={() => setSure(false)}>
        {sure() ? "sure? delete this chat" : "delete chat"}
      </button>
    </Card>
  )
}
