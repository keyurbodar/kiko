import type { Member } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { session } from "../../app/session"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { agentList } from "../new-chat-model"
import { addable, addOp, refusalText, renameOp, roleLabel } from "./model"

/*
 * The members section of the chat info panel: the human, then each agent with its role, model,
 * and status, and the controls to add, rename, and remove one. Every change goes out as the
 * room's `member` frame and shows at once; a refusal rolls it back and says why in a toast.
 */

const row = "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-text hover:bg-nav-hover"
const action = "rounded-md px-1.5 py-0.5 text-xs text-weak hover:bg-nav-hover hover:text-text"

/** Toasts each refusal from the open room while the section is on screen. */
function useRefusalToasts() {
  createEffect(() => {
    if (!useApp.room()) return
    const off = useApp.onMemberRefused((op, reason) => showToastV2({ title: refusalText(op, reason), variant: "error" }))
    onCleanup(off)
  })
}

/** What the agent is doing now: `typing`, `working`, or `idle`. */
const statusOf = (slug: string) => useApp.memberById(slug)?.presence ?? "idle"
/** The bird acts out what the agent is doing, and sits still when it is idle. */
const moodOf = (slug: string) => {
  const s = statusOf(slug)
  return s === "working" || s === "typing" ? s : undefined
}

/** The model's name without its provider, or nothing. */
const modelName = (ref: string | undefined) => ref?.split("/").slice(1).join("/") || undefined

function RenameInput(props: { member: Member; onDone: () => void }): JSX.Element {
  const commit = (value: string) => {
    const op = renameOp(props.member, value)
    if (op) useApp.memberOp(op)
    props.onDone()
  }
  return (
    <input
      class="h-7 min-w-0 flex-1 rounded-md bg-input px-2 text-sm text-text outline-none"
      aria-label={`rename ${props.member.name}`}
      value={props.member.name}
      data-component="member-rename"
      ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // The key stops here, so it never lands in the composer as a new line.
          e.preventDefault()
          e.currentTarget.blur()
        }
        else if (e.key === "Escape") {
          e.stopPropagation()
          props.onDone()
        }
      }}
    />
  )
}

/** One agent: face, name, role and model, status, and its rename and remove controls. */
function AgentRow(props: { member: Member; canRemove: boolean; onOpen: (slug: string) => void }): JSX.Element {
  const [renaming, setRenaming] = createSignal(false)
  const facts = () => [roleLabel(props.member), modelName(props.member.model), statusOf(props.member.slug)].filter(Boolean).join(" · ")
  return (
    <li class="group/member flex items-center gap-1" data-member={props.member.slug}>
      <Show
        when={!renaming()}
        fallback={
          <div class={row}>
            <IdentityAvatar seed={props.member.slug} size={32} state={moodOf(props.member.slug)} />
            <RenameInput member={props.member} onDone={() => setRenaming(false)} />
          </div>
        }
      >
        <button type="button" class={`${row} min-w-0 flex-1`} onClick={() => props.onOpen(props.member.slug)}>
          <IdentityAvatar seed={props.member.slug} size={32} state={moodOf(props.member.slug)} />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate">{props.member.name}</span>
            <span class="truncate text-xs text-weak" data-component="member-facts">
              {facts()}
            </span>
          </span>
        </button>
        <span class="flex shrink-0 gap-0.5 opacity-0 group-hover/member:opacity-100 group-focus-within/member:opacity-100">
          <button type="button" class={action} data-action="rename-agent" aria-label={`rename ${props.member.name}`} onClick={() => setRenaming(true)}>
            rename
          </button>
          <Show when={props.canRemove}>
            <button
              type="button"
              class={action}
              data-action="remove-agent"
              aria-label={`remove ${props.member.name}`}
              onClick={() => useApp.memberOp({ op: "remove", slug: props.member.slug })}
            >
              remove
            </button>
          </Show>
        </span>
      </Show>
    </li>
  )
}

/** The section body. `onOpen` shows one agent's own view. */
export function MemberList(props: { members: readonly Member[]; onOpen: (slug: string) => void }): JSX.Element {
  useRefusalToasts()
  const [adding, setAdding] = createSignal(false)
  const me = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  const candidates = () => addable(agentList(useApp.agents()), props.members)
  return (
    <>
      <ul class="flex flex-col" data-component="info-members">
        <li>
          <div class={row} data-member="human">
            <IdentityAvatar seed={me()?.id ?? "you"} size={32} />
            <span class="min-w-0 flex-1 truncate">{(me()?.name ?? "you").toLowerCase()}</span>
            <span class="text-xs text-weak">you</span>
          </div>
        </li>
        <For each={props.members}>
          {(m) => <AgentRow member={m} canRemove={props.members.length > 1 && m.slug !== "kiko"} onOpen={props.onOpen} />}
        </For>
      </ul>
      <Show
        when={adding()}
        fallback={
          <button type="button" class={`${row} text-weak`} data-action="add-agent" onClick={() => setAdding(true)}>
            <span class="grid size-8 place-items-center rounded-full bg-btn text-base">+</span>
            add
          </button>
        }
      >
        <div class="flex flex-col" data-component="member-add">
          <Show when={candidates().length > 0} fallback={<p class="px-2 py-2 text-sm text-weak">every agent is here. make a new one from the new chat screen.</p>}>
            <For each={candidates()}>
              {(agent) => (
                <button
                  type="button"
                  class={row}
                  data-action="add-member"
                  data-slug={agent.slug}
                  onClick={() => {
                    useApp.memberOp(addOp(agent))
                    setAdding(false)
                  }}
                >
                  <IdentityAvatar seed={agent.slug} size={32} />
                  <span class="min-w-0 flex-1 truncate">{agent.name}</span>
                  <span class="text-xs text-weak">@{agent.slug}</span>
                </button>
              )}
            </For>
          </Show>
          <button type="button" class={`${row} justify-center text-weak`} onClick={() => setAdding(false)}>
            cancel
          </button>
        </div>
      </Show>
    </>
  )
}
