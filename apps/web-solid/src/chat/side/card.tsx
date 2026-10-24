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
import "./card.css"
import { agentSurface, type FixedKind, fixedSurface, openSurface } from "./surfaces"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Row(props: { icon: Glyph; label: string; meta?: string; kind: FixedKind; chatId: string }) {
  return (
    <button
      type="button"
      class="group/row flex h-10 w-full items-center gap-3 rounded-[10px] px-2.5 text-left transition-[background-color,transform] duration-[120ms] ease-kiko hover:bg-hover active:scale-[0.98] active:bg-active"
      data-action={`open-${props.kind}`}
      onClick={() => openSurface(props.chatId, fixedSurface(props.kind))}
    >
      <RemixIcon icon={props.icon} size={16} class="shrink-0 text-fg2" />
      <span class="shrink-0 text-[14px] text-fg">{props.label}</span>
      <span class="min-w-0 flex-1 truncate text-right text-[12.5px] text-fg4">{props.meta}</span>
      <RemixIcon
        icon={ChevronRightIcon}
        size={13}
        class="-ml-1 w-0 shrink-0 text-fg4 opacity-0 transition-[opacity,width,transform] duration-[120ms] ease-kiko group-hover/row:w-[13px] group-hover/row:translate-x-0.5 group-hover/row:opacity-100"
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
  const memoryMeta = () => {
    const state = memory()?.state
    const kept = state?.lines.filter((line) => !line.redacted).length ?? 0
    if (!state || state.next === null) return kept ? plural(kept, "note") : "Empty"
    return `${kept}+ notes`
  }
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
      class="flex w-full flex-col rounded-2xl bg-panel p-1.5 shadow-[0_8px_28px_-12px_rgb(0_0_0/0.45)]"
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
            class={`flex items-center gap-1 truncate text-[12.5px] ${busy() ? "text-fg2" : "text-fg3"}`}
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
                class="flex h-7 items-center gap-1.5 rounded-full bg-active py-0.5 pr-2.5 pl-0.5 text-[13px] text-fg transition-[background-color,transform] duration-[120ms] hover:bg-hover active:scale-[0.97]"
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
              class="flex h-7 items-center gap-1 rounded-full py-0.5 pr-2.5 pl-2 text-[13px] text-fg3 transition-colors duration-[120ms] hover:bg-hover hover:text-fg aria-expanded:bg-hover"
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
      <div class="flex flex-col pt-1">
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
        <Row icon={MemoryIcon} label="Memory" kind="memory" chatId={props.chatId} meta={memoryMeta()} />
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
