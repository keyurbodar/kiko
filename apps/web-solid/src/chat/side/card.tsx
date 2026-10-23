import { type Agent, fileName, KIKO } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  ChevronRightIcon,
  FolderOpenIcon,
  type Glyph,
  MemoryIcon,
  PlusIcon,
  RepeatIcon,
  SparklesIcon,
  TasksIcon,
} from "@kiko/ui/icons"
import { openChat } from "../../app/history"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { ChatAvatar, IdentityAvatar } from "../../lib/IdentityAvatar"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { useMemoryStore } from "../info/memory/views"
import { routinesOf } from "../info/routines"
import { triggerLabel } from "../info/routines-model"
import { groupTitle, roomFor } from "../bot-picker-model"
import { addable, addOp } from "../members/model"
import { cardBeside, dismissCard } from "./card-state"
import { isGroup, liveLine, statusChip, workingLine } from "./overview-model"
import { agentSurface, type FixedKind, fixedSurface, openSurface } from "./surfaces"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Row(props: { icon: Glyph; label: string; meta?: string; kind: FixedKind; chatId: string }) {
  return (
    <button
      type="button"
      class="group/row flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-accent"
      data-action={`open-${props.kind}`}
      onClick={() => openSurface(props.chatId, fixedSurface(props.kind))}
    >
      <RemixIcon icon={props.icon} size={15} class="shrink-0 text-muted-foreground" />
      <span class="shrink-0 text-md text-foreground">{props.label}</span>
      <span class="min-w-0 flex-1 truncate text-right text-sm text-muted-foreground">{props.meta}</span>
      <RemixIcon
        icon={ChevronRightIcon}
        size={13}
        class="shrink-0 text-secondary-label opacity-0 group-hover/row:opacity-100"
      />
    </button>
  )
}

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
  const busy = () => statusChip(chat()?.presence).tone === "working" || working() !== null
  const files = () => room.files()
  const routines = () => routinesOf(props.chatId)
  const tasks = () => room.tasks() ?? []
  const open = () => tasks().filter((t) => t.status !== "done" && t.status !== "cancelled").length
  const next = () => routines().find((r) => r.status === "active")
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
      class="flex w-full flex-col rounded-2xl border border-border/60 bg-popover p-1.5 shadow-card"
      data-component="chat-card"
      aria-label="This chat"
    >
      <div class="flex items-center gap-3 px-2.5 pt-2 pb-2.5">
        <ChatAvatar faces={room.chatFaces(props.chatId)} size={32} />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-md font-medium text-foreground" data-component="card-name">
            {chat()?.name ?? ""}
          </span>
          <span
            class={`flex items-center gap-1 truncate text-xs ${busy() ? "text-ring" : "text-muted-foreground"}`}
            data-component="card-live"
          >
            <Show when={busy()}>
              <RemixIcon icon={SparklesIcon} size={11} class="shrink-0" />
            </Show>
            {liveLine(working(), chat(), clock())}
          </span>
        </div>
      </div>
      <Show when={isGroup(members())}>
        <div class="flex flex-wrap gap-1 px-2.5 pb-2.5" data-component="card-agents">
          <For each={members()}>
            {(m) => (
              <button
                type="button"
                class="flex h-7 items-center gap-1.5 rounded-full bg-accent py-0.5 pr-2.5 pl-0.5 text-sm text-foreground hover:bg-accent-strong"
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
              class="flex h-7 items-center gap-1 rounded-full border border-dashed border-border py-0.5 pr-2.5 pl-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent"
              aria-label="Add agent"
              data-action="add-member"
            >
              <RemixIcon icon={PlusIcon} size={13} />
              Add
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content class="z-[80] min-w-48" data-component="add-member-menu">
                <MenuV2.Group>
                  <MenuV2.GroupLabel class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
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
      <div class="flex flex-col border-t border-border pt-1.5">
        <Row
          icon={FolderOpenIcon}
          label="Files"
          kind="files"
          chatId={props.chatId}
          meta={
            files().length
              ? `${files()
                  .slice(-2)
                  .map((f) => fileName(f.name))
                  .join(", ")}${files().length > 2 ? ` +${files().length - 2}` : ""}`
              : "None yet"
          }
        />
        <Row
          icon={MemoryIcon}
          label="Memory"
          kind="memory"
          chatId={props.chatId}
          meta={memory()?.state.lines.length ? plural(memory()!.state.lines.length, "note") : "Empty"}
        />
        <Row
          icon={RepeatIcon}
          label="Routines"
          kind="routines"
          chatId={props.chatId}
          meta={next() ? triggerLabel(next()!.trigger, next()!.tz) : routines().length ? "Paused" : "None"}
        />
        <Show when={isGroup(members())}>
          <Row
            icon={TasksIcon}
            label="Tasks"
            kind="tasks"
            chatId={props.chatId}
            meta={tasks().length ? `${open()} open` : "None"}
          />
        </Show>
      </div>
    </aside>
  )
}
