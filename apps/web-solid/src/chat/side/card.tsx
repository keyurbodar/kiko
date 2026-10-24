import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronRightIcon, PlusIcon } from "@kiko/ui/icons"
import { createMemo, For, onMount, Show } from "solid-js"
import { AddSomeoneItems } from "../../composer/add-someone"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { room } from "../../state/room"
import { useMemoryStore } from "../info/memory/views"
import { routinesOf } from "../info/routines"
import { leadName } from "../info/empty"
import { DeskSettled, Files, Helpers, Memory, Now, Routines, Section, Tasks, Waiting } from "./desk-sections"
import { type FixedKind, PANELS } from "./panels"
import { isGroup } from "./overview-model"
import "./card.css"
import { agentSurface, fixedSurface, openSurface } from "./surfaces"

const press = "transition-[background-color,transform] duration-(--dur-hover) ease-kiko active:scale-[0.98]"

function AddMember(props: { chatId: string }) {
  return (
    <MenuV2 gutter={6} placement="bottom-start">
      <MenuV2.Trigger
        class="flex h-7 items-center gap-1 rounded-full py-0.5 pr-2.5 pl-2 text-[13px] text-fg3 transition-colors duration-(--dur-hover) hover:bg-hover hover:text-fg aria-expanded:bg-hover"
        aria-label="Add agent"
        data-action="add-member"
      >
        <RemixIcon icon={PlusIcon} size={13} />
        Add
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="z-[80] min-w-48" data-component="add-member-menu">
          <AddSomeoneItems chatId={props.chatId} />
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function Drill(props: { chatId: string; kind: FixedKind; label: string }) {
  return (
    <button
      type="button"
      class={`group/drill flex h-9 items-center gap-2.5 rounded-row px-2 text-left text-ui text-fg hover:bg-hover ${press}`}
      data-action={`open-${props.kind}`}
      onClick={() => openSurface(props.chatId, fixedSurface(props.kind))}
    >
      <RemixIcon icon={PANELS[props.kind].icon} size={16} class="shrink-0 text-fg2" />
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <RemixIcon
        icon={ChevronRightIcon}
        size={14}
        class="shrink-0 text-fg4 transition-transform duration-(--dur-hover) ease-kiko group-hover/drill:translate-x-0.5"
      />
    </button>
  )
}

export default function DeskOverview(props: { chatId: string }) {
  let settled = false
  onMount(() => requestAnimationFrame(() => (settled = true)))
  const memory = useMemoryStore()
  const members = () => room.roomMembers()
  const chat = () => room.chatById(props.chatId)
  const working = () => {
    const row = chat()
    return row && row.presence !== "idle" ? (row.typing ?? null) : null
  }
  const files = () => room.files()
  const routines = () => routinesOf(props.chatId)
  const tasks = () => room.tasks() ?? []
  const asks = () => room.active()?.asks() ?? []
  const lines = () => memory()?.state.lines.filter((l) => !l.redacted) ?? []
  const hasMemory = () => lines().length > 0
  const workers = createMemo(() =>
    Object.keys(room.status()).length
      ? (room.snapshot()?.agents ?? []).flatMap((a) => (a.activity?.kind === "background" ? a.activity.workers : []))
      : [],
  )
  const hasTasks = () => tasks().some((t) => t.status !== "cancelled")
  const missing = createMemo(() => {
    const out: { kind: FixedKind; label: string }[] = []
    if (files().length === 0) out.push({ kind: "files", label: "Files" })
    if (!hasMemory() && memory()?.state.loaded === true) out.push({ kind: "memory", label: `${leadName()} knows here` })
    if (routines().length === 0) out.push({ kind: "routines", label: "Routines" })
    if (!hasTasks() && isGroup(members())) out.push({ kind: "tasks", label: "Tasks" })
    return out
  })
  const empty = () =>
    working() === null &&
    asks().length === 0 &&
    !hasTasks() &&
    workers().length === 0 &&
    files().length === 0 &&
    routines().length === 0 &&
    !hasMemory() &&
    memory()?.state.loaded === true

  return (
    <div
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-4"
      data-component="chat-card"
    >
      <DeskSettled.Provider value={() => settled}>
        <Show when={isGroup(members())}>
          <div class="flex flex-wrap gap-1" data-component="card-agents">
            <For each={members()}>
              {(m) => (
                <button
                  type="button"
                  class={`flex h-7 items-center gap-1.5 rounded-full bg-active py-0.5 pr-2.5 pl-0.5 text-[13px] text-fg hover:bg-hover ${press}`}
                  data-member={m.slug}
                  onClick={() => openSurface(props.chatId, agentSurface(m.slug))}
                >
                  <IdentityAvatar seed={m.slug} size={22} />
                  {m.name}
                </button>
              )}
            </For>
            <AddMember chatId={props.chatId} />
          </div>
        </Show>
        <Show when={working()}>
          {(line) => (
            <Section label="Now" chatId={props.chatId}>
              <Now line={line()} slug={room.typingSlugs()[0]} tasks={tasks()} />
            </Section>
          )}
        </Show>
        <Show when={asks().length}>
          <Waiting asks={asks()} chatId={props.chatId} />
        </Show>
        <Show when={hasTasks()}>
          <Tasks tasks={tasks()} chatId={props.chatId} />
        </Show>
        <Show when={workers().length}>
          <Helpers workers={workers()} chatId={props.chatId} />
        </Show>
        <Show when={files().length}>
          <Files files={files()} chatId={props.chatId} />
        </Show>
        <Show when={hasMemory()}>
          <Memory lines={lines()} more={memory()?.state.next != null} whose={leadName()} chatId={props.chatId} />
        </Show>
        <Show when={routines().length}>
          <Routines routines={routines()} chatId={props.chatId} />
        </Show>
        <Show when={empty()}>
          <p class="px-1 text-ui text-fg3" data-component="card-empty">
            {`Nothing here yet. Files, tasks and what ${leadName()} learns will show up here.`}
          </p>
        </Show>
        <Show when={missing().length}>
          <div class="-mx-1 flex flex-col" data-component="card-more">
            <For each={missing()}>
              {(entry) => <Drill chatId={props.chatId} kind={entry.kind} label={entry.label} />}
            </For>
          </div>
        </Show>
      </DeskSettled.Provider>
    </div>
  )
}
