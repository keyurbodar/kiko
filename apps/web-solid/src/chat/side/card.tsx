import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { For, onMount, Show } from "solid-js"
import { AddSomeoneItems } from "../../composer/add-someone"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { room } from "../../state/room"
import { useMemoryStore } from "../info/memory/views"
import { routinesOf } from "../info/routines"
import { leadName, PanelEmpty } from "../info/empty"
import { DeskSettled, Files, Helpers, Now, Section, Tasks, Used, Waiting } from "./desk-sections"
import { useDeskMode } from "./desk-live"
import { isGroup } from "./overview-model"
import "./card.css"
import { agentSurface, openSurface } from "./surfaces"

const press = "transition-[background-color,transform] duration-(--dur-hover) ease-kiko active:scale-[0.98]"

function AddMember(props: { chatId: string }) {
  return (
    <MenuV2 gutter={6} placement="bottom-start">
      <MenuV2.Trigger
        class="flex h-7 items-center gap-1 rounded-full py-0.5 pr-2.5 pl-2 text-label text-fg3 transition-colors duration-(--dur-hover) hover:bg-hover hover:text-fg aria-expanded:bg-hover"
        aria-label="Add agent"
        data-action="add-member"
      >
        <RemixIcon icon={PlusIcon} size={12} />
        Add
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-48" data-component="add-member-menu">
          <AddSomeoneItems chatId={props.chatId} />
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
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
  const mode = useDeskMode(() => props.chatId)
  const files = () => room.files()
  const routines = () => routinesOf(props.chatId)
  const tasks = () => room.tasks() ?? []
  const asks = () => room.active()?.asks() ?? []
  const lanes = () =>
    room
      .helpers()
      .toReversed()
      .toSorted((a, b) => Number(b.state === "working") - Number(a.state === "working"))
  const lines = () => memory()?.state.lines.filter((l) => !l.redacted) ?? []
  const hasTasks = () => tasks().some((t) => t.status !== "cancelled")
  const isDone = () => mode() === "done"
  const finished = () => tasks().every((t) => t.status === "done" || t.status === "cancelled")
  const empty = () =>
    working() === null &&
    asks().length === 0 &&
    !hasTasks() &&
    lanes().length === 0 &&
    files().length === 0 &&
    routines().length === 0 &&
    lines().length === 0 &&
    memory()?.state.loaded === true

  return (
    <div
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-1 pb-4"
      data-component="chat-card"
      data-mode={mode()}
    >
      <DeskSettled.Provider value={() => settled}>
        <Show when={isGroup(members())}>
          <div class="flex flex-wrap gap-1" data-component="card-agents">
            <For each={members()}>
              {(m) => (
                <button
                  type="button"
                  class={`flex h-7 items-center gap-1.5 rounded-full bg-fill py-0.5 pr-2.5 pl-0.5 text-label text-fg hover:bg-fill-hover ${press}`}
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
        <Show when={asks().length}>
          <Waiting asks={asks()} chatId={props.chatId} />
        </Show>
        <Show when={!isDone() && !hasTasks() ? working() : null}>
          {(line) => (
            <Section label="Now" chatId={props.chatId}>
              <Now line={line()} slug={room.typingSlugs()[0]} tasks={tasks()} />
            </Section>
          )}
        </Show>
        <Show when={isDone() && files().length}>
          <Files files={files()} chatId={props.chatId} />
        </Show>
        <Show when={isDone()}>
          <Used files={files()} lines={lines()} chatId={props.chatId} />
        </Show>
        <Show when={hasTasks()}>
          <Tasks tasks={tasks()} chatId={props.chatId} fold={isDone() && finished()} />
        </Show>
        <Show when={lanes().length}>
          <Helpers lanes={lanes()} chatId={props.chatId} />
        </Show>
        <Show when={!isDone() && files().length}>
          <Files files={files()} chatId={props.chatId} />
        </Show>
        <Show when={empty()}>
          <PanelEmpty
            art="thinking"
            title="Nothing here yet"
            line={`Files, tasks and what ${leadName()} learns will show up here.`}
            component="card-empty"
          />
        </Show>
      </DeskSettled.Provider>
    </div>
  )
}
