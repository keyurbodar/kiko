import type { Agent, Member } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useNavigate } from "@solidjs/router"
import { Check, ChevronRight, Clock, Ellipsis, Moon, Pause, Play, Plus, Sparkles, X, Zap } from "lucide-solid"
import { createSignal, For, onMount, Show, type JSX } from "solid-js"
import { EntryIcon } from "../../files/entry-icon"
import { agentList } from "../../lib/chats"
import { Dialog } from "../../lib/dialog"
import { ChatAvatar, IdentityAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { Button } from "../../settings/kit"
import { deleteChat } from "../../sidebar/actions"
import { act, loadLoops, loopsOf, type PlateLoop, tomorrow } from "../info/loops"
import { useMemoryStore } from "../info/memory/views"
import { loadRoutines, ranNow, type Routine, routinesOf, runNow, setStatus } from "../info/routines"
import { triggerLabel } from "../info/routines-model"
import { addable, addOp } from "../members/model"
import { useRefusalToasts } from "../members/members"
import { type AgentRow, type Chip, agentRows, comingUp, fileList, isGroup, liveLine, memoryPick, statusChip, workingLine } from "./overview-model"
import { agentSurface, type FixedKind, fixedSurface, launcherEntries, openFile, openSurface } from "./surfaces"

/** An upload is stored as `attachments/<stamp>-<name>`. The row shows the name the human picked. */
const shownName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/^[a-z0-9]{6,10}-(?=.)/, (m) => (path.startsWith("attachments/") ? "" : m))

const row = "group/row flex min-h-8 items-center gap-2.5 rounded-md px-2 hover:bg-accent focus-within:bg-accent"
const iconButton = "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent-strong hover:text-foreground"
const tool = `${iconButton} opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100`

function StatusChip(props: { chip: Chip }) {
  const working = () => props.chip.tone === "working"
  return (
    <span
      class={`inline-flex h-5 shrink-0 items-center gap-1 text-xs ${working() ? "text-ring" : "text-secondary-label"}`}
      data-component="status-chip"
      data-tone={props.chip.tone}
    >
      <Show when={working()} fallback={<Moon size={12} strokeWidth={1.75} />}>
        <Sparkles size={12} strokeWidth={1.75} />
      </Show>
      {props.chip.label}
    </span>
  )
}

function Section(props: { title: string; open?: () => void; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-0.5 px-2 pt-4" data-component="card-section" data-section={props.title}>
      <div class="flex h-6 items-center justify-between gap-2 px-2">
        <Show when={props.open} fallback={<h3 class="text-xs font-medium text-muted-foreground">{props.title}</h3>}>
          {(open) => (
            <button type="button" class="group/title flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={open()}>
              {props.title}
              <ChevronRight size={12} strokeWidth={2} class="opacity-0 group-hover/title:opacity-100" />
            </button>
          )}
        </Show>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

function AddAgent(props: { members: readonly Member[] }) {
  const candidates = (): Agent[] => addable(agentList(useApp.agents()), props.members)
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger class={iconButton} aria-label="Add agent" data-action="add-agent">
        <Plus size={14} strokeWidth={1.75} />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-[240px] max-w-[300px]">
          <MenuV2.Group>
            <MenuV2.GroupLabel>Add to this chat</MenuV2.GroupLabel>
            <Show when={candidates().length > 0} fallback={<p class="px-3 pb-2 text-sm text-muted-foreground">Every agent is here. Ask Kiko to make a new one.</p>}>
              <For each={candidates()}>
                {(agent) => (
                  <MenuV2.Item data-action="add-member" data-slug={agent.slug} onSelect={() => useApp.memberOp(addOp(agent))}>
                    <IdentityAvatar seed={agent.slug} size={20} />
                    <span class="min-w-0 flex-1 truncate">{agent.name}</span>
                  </MenuV2.Item>
                )}
              </For>
            </Show>
          </MenuV2.Group>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function AgentLine(props: { agent: AgentRow; chatId: string }) {
  return (
    <li class={row} data-member={props.agent.slug}>
      <button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left" onClick={() => openSurface(props.chatId, agentSurface(props.agent.slug))}>
        <IdentityAvatar seed={props.agent.slug} size={24} />
        <span class="min-w-0 truncate text-md text-foreground">{props.agent.name}</span>
        <Show when={props.agent.lead}>
          <span class="shrink-0 text-xs text-secondary-label" data-component="lead-chip">Lead</span>
        </Show>
      </button>
      <StatusChip chip={props.agent.chip} />
      <Show when={props.agent.removable} fallback={<span class="size-6 shrink-0" aria-hidden="true" />}>
        <MenuV2 gutter={4} placement="bottom-end">
          <MenuV2.Trigger class={tool} aria-label={`${props.agent.name} actions`} data-action="member-actions">
            <Ellipsis size={14} strokeWidth={1.75} />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="min-w-[176px]">
              <MenuV2.Item class="text-error" data-action="remove-agent" onSelect={() => useApp.memberOp({ op: "remove", slug: props.agent.slug as Member["slug"] })}>
                Remove from chat
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </Show>
    </li>
  )
}

function RoutineLine(props: { routine: Routine; chatId: string }) {
  const active = () => props.routine.status === "active"
  const ran = () => ranNow(props.routine.id)
  return (
    <li class={row} data-routine={props.routine.id} data-status={props.routine.status}>
      <button type="button" class="flex min-w-0 flex-1 flex-col py-1 text-left" onClick={() => openSurface(props.chatId, fixedSurface("routines"))}>
        <span class="truncate text-md text-foreground">{props.routine.name}</span>
        <span class="truncate text-xs text-secondary-label">{ran() ? "Started just now" : `${active() ? "" : "Paused · "}${triggerLabel(props.routine.trigger, props.routine.tz)}`}</span>
      </button>
      <button type="button" class={`${tool} disabled:text-secondary-label`} aria-label={ran() ? "Started" : "Run now"} title={ran() ? "Started" : "Run now"} disabled={ran()} data-action="routine-run" onClick={() => void runNow(props.routine)}>
        <Zap size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        class={tool}
        aria-label={active() ? "Pause" : "Resume"}
        title={active() ? "Pause" : "Resume"}
        data-action="routine-toggle"
        onClick={() => void setStatus(props.routine, active() ? "paused" : "active")}
      >
        <Show when={active()} fallback={<Play size={14} strokeWidth={1.75} />}>
          <Pause size={14} strokeWidth={1.75} />
        </Show>
      </button>
    </li>
  )
}

function LoopLine(props: { loop: PlateLoop; chatId: string }) {
  return (
    <li class={row} data-loop={props.loop.id}>
      <button type="button" class="min-w-0 flex-1 truncate py-1.5 text-left text-md text-foreground" onClick={() => openSurface(props.chatId, fixedSurface("plate"))}>
        {props.loop.text}
      </button>
      <button type="button" class={tool} aria-label="Done" title="Done" data-action="loop-done" onClick={() => void act(props.loop, { action: "done" }, "Could not mark that done")}>
        <Check size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        class={tool}
        aria-label="Snooze until tomorrow"
        title="Snooze until tomorrow"
        data-action="loop-snooze"
        onClick={() => void act(props.loop, { action: "snooze", until: tomorrow() }, "Could not snooze that")}
      >
        <Clock size={14} strokeWidth={1.75} />
      </button>
      <button type="button" class={tool} aria-label="Drop" title="Drop" data-action="loop-drop" onClick={() => void act(props.loop, { action: "drop" }, "Could not drop that")}>
        <X size={14} strokeWidth={1.75} />
      </button>
    </li>
  )
}

/** The sidecar's home: who is in the chat, what is coming up, recent files and memory, and every surface. */
export function Overview(props: { chatId: string; icons: Record<FixedKind, (p: { size: number; strokeWidth: number; class: string }) => JSX.Element> }) {
  const navigate = useNavigate()
  const memory = useMemoryStore()
  const [confirmDelete, setConfirmDelete] = createSignal(false)

  const members = () => useApp.roomMembers()
  const group = () => isGroup(members())
  const chat = () => useApp.chatById(props.chatId)
  const open = (kind: FixedKind) => () => openSurface(props.chatId, fixedSurface(kind))

  onMount(() => {
    void loadRoutines()
    void loadLoops()
  })
  useRefusalToasts()

  const working = () => {
    const names = useApp.typingNames()
    const doings = useApp.typingDoings()
    return workingLine(
      names.map((name, i) => ({ name, doing: doings[i] })),
      group(),
    )
  }
  const up = () => comingUp(routinesOf(props.chatId) ?? [], loopsOf(props.chatId) ?? [])
  const agents = () => agentRows(members(), (slug) => useApp.memberById(slug)?.presence)
  const files = () => fileList(useApp.activeFiles())
  const lines = () => memoryPick(memory()?.state.lines ?? [])

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none pb-4" data-component="sidecar-overview">
      <header class="flex items-center gap-3 px-4 pt-2 pb-1">
        <ChatAvatar faces={useApp.chatFaces(props.chatId)} size={36} />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-base font-medium text-foreground" data-component="card-name">
            {chat()?.name ?? "New chat"}
          </span>
          <span class="truncate text-xs text-muted-foreground" data-component="card-live">
            {liveLine(working(), chat()?.updatedAt, Date.now())}
          </span>
        </div>
        <Show when={!group()}>
          <StatusChip chip={statusChip(chat()?.presence)} />
        </Show>
        <Show when={useApp.kikoChatId() !== props.chatId}>
          <MenuV2 gutter={4} placement="bottom-end">
            <MenuV2.Trigger class={iconButton} aria-label="More" data-action="card-more">
              <Ellipsis size={16} strokeWidth={1.75} />
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content class="min-w-[176px]">
                <MenuV2.Item class="text-error" data-action="delete-chat" onSelect={() => setConfirmDelete(true)}>
                  Delete chat
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </Show>
      </header>

      <Show when={group()}>
        <Section title="Agents" action={<AddAgent members={members()} />}>
          <ul class="flex flex-col">
            <For each={agents()}>{(agent) => <AgentLine agent={agent} chatId={props.chatId} />}</For>
          </ul>
        </Section>
      </Show>

      <Show when={up().routines.length + up().loops.length > 0}>
        <Section title="Coming up">
          <ul class="flex flex-col">
            <For each={up().routines}>{(r) => <RoutineLine routine={r} chatId={props.chatId} />}</For>
            <For each={up().loops}>{(l) => <LoopLine loop={l} chatId={props.chatId} />}</For>
          </ul>
        </Section>
      </Show>

      <Show when={files().length > 0}>
        <Section title="Files" open={open("files")}>
          <ul class="flex flex-col">
            <For each={files()}>
              {(file) => (
                <li>
                  <button type="button" class={`${row} w-full text-left`} data-file={file.name} onClick={() => openFile(props.chatId, file.name)}>
                    <EntryIcon path={file.name} />
                    <span class="min-w-0 flex-1 truncate text-md text-foreground" title={file.name}>{shownName(file.name)}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Section>
      </Show>

      <Show when={lines().length > 0}>
        <Section title="Memory" open={open("memory")}>
          <ul class="flex flex-col">
            <For each={lines()}>
              {(line) => (
                <li>
                  <button type="button" class={`${row} w-full py-1.5 text-left`} data-pos={line.pos} onClick={open("memory")}>
                    <span class="line-clamp-2 text-md leading-snug text-muted-foreground">{line.text}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Section>
      </Show>

      <Section title="Open">
        <ul class="flex flex-col" data-component="sidecar-launcher">
          <For each={launcherEntries(group())}>
            {(entry) => {
              const Glyph = props.icons[entry.kind]
              return (
                <li>
                  <button type="button" class={`${row} w-full text-left`} data-action={`open-${entry.kind}`} onClick={open(entry.kind)}>
                    <Glyph size={15} strokeWidth={1.75} class="shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1 truncate text-md text-foreground">{entry.label}</span>
                    <kbd class="grid h-5 min-w-5 place-items-center rounded bg-control px-1 font-sans text-xs text-muted-foreground">{entry.key}</kbd>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
      </Section>

      <Dialog
        open={confirmDelete()}
        onClose={() => setConfirmDelete(false)}
        title="Delete chat?"
        data-component="card-delete"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" data-action="confirm-delete" onClick={() => deleteChat(props.chatId, props.chatId, navigate)}>
              Delete
            </Button>
          </>
        }
      >
        <p class="text-md text-muted-foreground">This removes the chat and its messages.</p>
      </Dialog>
    </div>
  )
}
