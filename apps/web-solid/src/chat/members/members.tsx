import type { Member } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { MoreIcon, PlusIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { session } from "../../app/session"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { agentList } from "../../lib/chats"
import { openBirdPicker } from "../../mascot/picker-state"
import { addable, addOp, refusalText, renameOp, roleLabel } from "./model"

/*
 * The members section of the chat info panel: the human, then each agent with its role, model,
 * and status. An agent's actions (rename, change bird, remove) are its right-click menu, and add
 * is a menu of the agents not here yet. Every change goes out as the
 * room's `member` frame and shows at once; a refusal rolls it back and says why in a toast.
 */

// Monocode's rows and buttons: 13px text on an 8px-cornered hover fill; small 12px buttons.
const row = "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] text-text outline-none hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)] data-[expanded]:bg-[var(--selected-bg)]"
const secondary = "h-7 rounded-md px-2.5 text-[12px] text-muted shadow-[inset_0_0_0_1px_var(--hairline)] outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
const primary = "h-7 rounded-md bg-[var(--accent-fill)] px-2.5 text-[12px] font-medium text-[var(--on-accent)] outline-none hover:bg-[var(--accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"

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

/** Renames an agent in a small dialog, as monocode renames a session. */
function RenameDialog(props: { member: Member; onClose: () => void }): JSX.Element {
  let input: HTMLInputElement | undefined
  const commit = () => {
    const op = renameOp(props.member, input?.value ?? "")
    if (op) useApp.memberOp(op)
    props.onClose()
  }
  return (
    <ModalV2 open onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content class="bg-menu flex w-[min(360px,calc(100vw-32px))] flex-col gap-3 rounded-2xl p-4 text-text shadow-popover" data-component="member-rename">
          <ModalV2.Title class="text-[14px] font-semibold">Rename {props.member.name}</ModalV2.Title>
          <input
            ref={(el) => {
              input = el
              queueMicrotask(() => (el.focus(), el.select()))
            }}
            class="h-8 w-full rounded-lg bg-[var(--input-bg)] px-2.5 text-[13px] text-text outline-none shadow-[inset_0_0_0_1px_var(--hairline)]"
            aria-label={`New name for ${props.member.name}`}
            value={props.member.name}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // The key stops here, so it never lands in the composer as a new line.
                e.preventDefault()
                commit()
              }
            }}
          />
          <div class="flex justify-end gap-2">
            <button type="button" class={secondary} onClick={() => props.onClose()}>
              Cancel
            </button>
            <button type="button" class={primary} data-action="save-rename" onClick={commit}>
              Rename
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}

/** One agent: face, name, role and model, status. Its actions are a right-click menu and the same menu behind the dots. */
function AgentRow(props: { member: Member; canRemove: boolean; onOpen: (slug: string) => void }): JSX.Element {
  const [renaming, setRenaming] = createSignal(false)
  const facts = () => [roleLabel(props.member), modelName(props.member.model), statusOf(props.member.slug)].filter(Boolean).join(" · ")
  const items = () => (
    <>
      <MenuV2.Item onSelect={() => setRenaming(true)} data-action="rename-agent">
        Rename
      </MenuV2.Item>
      <MenuV2.Item onSelect={() => openBirdPicker(props.member.slug)}>Change bird</MenuV2.Item>
      <MenuV2.Item onSelect={() => props.onOpen(props.member.slug)}>Open profile</MenuV2.Item>
      <Show when={props.canRemove}>
        <MenuV2.Separator />
        <MenuV2.Item class="text-danger" data-action="remove-agent" onSelect={() => useApp.memberOp({ op: "remove", slug: props.member.slug })}>
          Remove from chat
        </MenuV2.Item>
      </Show>
    </>
  )
  return (
    <li class="group/member relative flex items-center" data-member={props.member.slug}>
      <MenuV2.Context>
        <MenuV2.Context.Trigger class="min-w-0 flex-1">
          <button type="button" class={`${row} pr-9`} onClick={() => props.onOpen(props.member.slug)}>
            <IdentityAvatar seed={props.member.slug} size={30} state={moodOf(props.member.slug)} />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-medium">{props.member.name}</span>
              <span class="truncate text-[11px] text-weak" data-component="member-facts">
                {facts()}
              </span>
            </span>
          </button>
        </MenuV2.Context.Trigger>
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content class="min-w-[176px]" data-component="member-menu">
            {items()}
          </MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
      <MenuV2 gutter={4} placement="bottom-end">
        <MenuV2.Trigger
          class="absolute right-1.5 grid size-7 place-items-center rounded-md text-weak opacity-0 outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:opacity-100 group-hover/member:opacity-100 data-[expanded]:opacity-100"
          aria-label={`${props.member.name} actions`}
          data-action="member-actions"
        >
          <HugeIcon icon={MoreIcon} size={15} />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="min-w-[176px]">{items()}</MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
      <Show when={renaming()}>
        <RenameDialog member={props.member} onClose={() => setRenaming(false)} />
      </Show>
    </li>
  )
}

/** The section body. `onOpen` shows one agent's own view. */
export function MemberList(props: { members: readonly Member[]; onOpen: (slug: string) => void }): JSX.Element {
  useRefusalToasts()
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
            <IdentityAvatar seed={me()?.id ?? "you"} size={30} />
            <span class="min-w-0 flex-1 truncate">{me()?.name ?? "You"}</span>
            <span class="text-xs text-weak">You</span>
          </div>
        </li>
        <For each={props.members}>
          {(m) => <AgentRow member={m} canRemove={props.members.length > 1 && m.slug !== "kiko"} onOpen={props.onOpen} />}
        </For>
      </ul>
      <MenuV2 gutter={4} placement="bottom-start">
        <MenuV2.Trigger class={`${row} text-weak`} data-action="add-agent">
          <span class="grid size-[30px] place-items-center rounded-full bg-[var(--tint-subtle)]">
            <HugeIcon icon={PlusIcon} size={14} />
          </span>
          Add
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="min-w-[240px] max-w-[300px]" data-component="member-add">
            <MenuV2.GroupLabel>Add to this chat</MenuV2.GroupLabel>
            <Show when={candidates().length > 0} fallback={<p class="px-3 pb-2 text-[12px] text-weak">Every agent is here. Ask Kiko to make a new one.</p>}>
              <For each={candidates()}>
                {(agent) => (
                  <MenuV2.Item data-action="add-member" data-slug={agent.slug} onSelect={() => useApp.memberOp(addOp(agent))}>
                    <IdentityAvatar seed={agent.slug} size={20} />
                    <span class="min-w-0 flex-1 truncate">{agent.name}</span>
                    <span class="text-[11px] text-weak">@{agent.slug}</span>
                  </MenuV2.Item>
                )}
              </For>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </>
  )
}
