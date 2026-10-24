import { type Agent, KIKO } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { PlusIcon } from "@kiko/ui/icons"
import { openChat } from "../../app/history"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { ChatAvatar, IdentityAvatar } from "../../lib/IdentityAvatar"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { useMemoryStore } from "../info/memory/views"
import { routinesOf } from "../info/routines"
import { groupTitle, roomFor } from "../bot-picker-model"
import { addable, addOp } from "../members/model"
import { cardBeside, dismissCard } from "./card-state"
import { Files, Helpers, leadName, Memory, Now, Routines, Section, Tasks, Waiting } from "./desk-sections"
import { launcherEntries, PANELS } from "./panels"
import { isGroup, liveLine, workingLine } from "./overview-model"
import "./card.css"
import { agentSurface, fixedSurface, openSurface } from "./surfaces"

export default function ChatCard(props: { chatId: string }) {
  const memory = useMemoryStore()
  const members = () => room.roomMembers()
  const chat = () => room.chatById(props.chatId)
  const [clock, setClock] = createSignal(Date.now())
  const ticker = setInterval(() => setClock(Date.now()), 30_000)
  onCleanup(() => clearInterval(ticker))
  const add = (agent: Agent) => {
    if (props.chatId !== user.kikoChatId()) return room.memberOp(addOp(agent))
    const roomId = user.createChat(groupTitle(["Kiko", agent.name]), roomFor([KIKO, agent.id]))
    if (roomId) openChat(roomId)
  }
  const working = () => {
    const doings = room.typingDoings()
    return workingLine(
      room.typingNames().map((name, i) => ({ name, doing: doings[i] })),
      isGroup(members()),
    )
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
  const empty = () =>
    working() === null &&
    asks().length === 0 &&
    tasks().length === 0 &&
    workers().length === 0 &&
    files().length === 0 &&
    routines().length === 0 &&
    !hasMemory() &&
    memory()?.state.loaded === true
  let card: HTMLElement | undefined
  createEffect(() => {
    if (cardBeside()) return
    const away = (event: PointerEvent) => {
      const target = event.target
      if (
        !(target instanceof Element) ||
        card?.contains(target) ||
        target.closest('[data-action="toggle-card"], [data-component="add-member-menu"]')
      )
        return
      dismissCard()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) dismissCard()
    }
    document.addEventListener("pointerdown", away, true)
    document.addEventListener("keydown", onEscape)
    onCleanup(() => {
      document.removeEventListener("pointerdown", away, true)
      document.removeEventListener("keydown", onEscape)
    })
  })

  return (
    <aside
      ref={card}
      class="desk-card flex max-h-full w-full flex-col gap-4 overflow-y-auto overscroll-contain rounded-card bg-panel p-4 shadow-(--float-shadow)"
      data-component="chat-card"
      aria-label="This chat"
    >
      <div class="flex items-center gap-3">
        <ChatAvatar faces={room.chatFaces(props.chatId)} size={40} />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate type-row text-fg" data-component="card-name">
            {chat()?.name ?? ""}
          </span>
          <span class="truncate text-label text-fg3" data-component="card-live">
            {isGroup(members())
              ? members()
                  .map((m) => m.name)
                  .join(", ")
              : liveLine(null, chat(), clock())}
          </span>
        </div>
      </div>
      <Show when={isGroup(members())}>
        <div class="-mt-1 flex flex-wrap gap-1" data-component="card-agents">
          <For each={members()}>
            {(m) => (
              <button
                type="button"
                class="flex h-7 items-center gap-1.5 rounded-full bg-active py-0.5 pr-2.5 pl-0.5 text-[13px] text-fg transition-[background-color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover active:scale-[0.97]"
                data-member={m.slug}
                onClick={() => openSurface(props.chatId, agentSurface(m.slug))}
              >
                <IdentityAvatar seed={m.slug} size={22} />
                {m.name}
              </button>
            )}
          </For>
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
                <MenuV2.Group>
                  <MenuV2.GroupLabel class="px-2 pt-1.5 pb-1 text-hint font-medium text-fg2">
                    Add to this chat
                  </MenuV2.GroupLabel>
                  <Show
                    when={addable(user.agents(), members()).length > 0}
                    fallback={<MenuV2.Item disabled>No other agents</MenuV2.Item>}
                  >
                    <For each={addable(user.agents(), members())}>
                      {(agent) => (
                        <MenuV2.Item data-add-member={agent.slug} onSelect={() => add(agent)}>
                          <IdentityAvatar seed={agent.slug} size={18} />
                          {agent.name}
                        </MenuV2.Item>
                      )}
                    </For>
                  </Show>
                </MenuV2.Group>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </Show>
      <Show when={working()}>
        <Section label="Now" chatId={props.chatId}>
          <Now line={working() ?? ""} slug={room.typingSlugs()[0]} tasks={tasks()} />
        </Section>
      </Show>
      <Show when={asks().length}>
        <Waiting asks={asks()} chatId={props.chatId} />
      </Show>
      <Show when={tasks().some((t) => t.status !== "cancelled")}>
        <Tasks tasks={tasks()} chatId={props.chatId} />
      </Show>
      <Show when={workers().length}>
        <Helpers workers={workers()} chatId={props.chatId} />
      </Show>
      <Show when={files().length}>
        <Files files={files()} chatId={props.chatId} />
      </Show>
      <Show when={routines().length}>
        <Routines routines={routines()} chatId={props.chatId} />
      </Show>
      <Show when={hasMemory()}>
        <Memory lines={lines()} more={memory()?.state.next != null} whose={leadName()} chatId={props.chatId} />
      </Show>
      <Show when={empty()}>
        <div class="desk-section flex flex-col gap-1" data-component="card-empty">
          <p class="px-1 pb-1 text-ui text-fg3">
            Nothing here yet. Files, tasks and what Kiko learns will gather here.
          </p>
          <For each={launcherEntries(isGroup(members()))}>
            {(entry) => (
              <button
                type="button"
                class="flex h-9 items-center gap-2.5 rounded-row px-2 text-left text-ui text-fg transition-[background-color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover active:scale-[0.98]"
                data-action={`open-${entry.kind}`}
                onClick={() => openSurface(props.chatId, fixedSurface(entry.kind))}
              >
                <RemixIcon icon={PANELS[entry.kind].icon} size={16} class="shrink-0 text-fg2" />
                {entry.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </aside>
  )
}
