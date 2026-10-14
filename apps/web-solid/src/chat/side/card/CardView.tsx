import type { Agent, Member } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { useLocation, useNavigate } from "@solidjs/router"
import { Check, Clock, Ellipsis, FileText, Moon, Pause, Play, Plus, Sparkles, X, Zap } from "lucide-solid"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Dialog } from "../../../lib/dialog"
import { agentList } from "../../../lib/chats"
import { ChatAvatar, IdentityAvatar } from "../../../lib/IdentityAvatar"
import { useApp } from "../../../lib/store"
import { Button } from "../../../settings/kit"
import { deleteChat } from "../../../sidebar/actions"
import { act, loadLoops, loopsOf, type PlateLoop, tomorrow } from "../../info/loops"
import { useMemoryStore } from "../../info/memory/views"
import { loadRoutines, ranNow, type Routine, routinesOf, runNow, setStatus } from "../../info/routines"
import { triggerLabel } from "../../info/routines-model"
import { addable, addOp } from "../../members/model"
import { useRefusalToasts } from "../../members/members"
import { fixedSurface, openFile, openSurface } from "../surfaces"
import { type AgentRow, type Chip, agentRows, comingUp, fileList, isGroup, liveLine, memoryPick, statusChip, workingLine } from "./model"

/*
 * The chat card: a popover over the thread, under the top bar. It shows who is here, what is coming
 * up, and this chat's recent files and memory. It never changes the chat's layout. It closes on a
 * pointer down outside it (not on its own toggle), Escape, a route change, and focus moving into the
 * composer. Nothing animates.
 */

/** Pointer downs here do not close the card: its toggle, and the menus and dialogs it opens. */
const KEEP_OPEN = '[data-action="toggle-card"], [data-action="toggle-sidecar"], [data-component="sidecar"], [data-component="sidecar-overlay"], [data-component="top-bar"], [role="menu"], [role="dialog"]'

const faint = "text-[var(--text-faint)]"
const row = "group/row flex min-h-9 items-center gap-2.5 rounded-[10px] px-2 hover:bg-[var(--hover-bg)] focus-within:bg-[var(--hover-bg)]"
const iconButton = "grid size-6 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--selected-bg)] hover:text-[var(--text)]"
/** Row buttons appear on hover and when focus is inside the row. Touch has no hover, so they stay visible there. */
const tool = `${iconButton} opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100`

function StatusChip(props: { chip: Chip }) {
  const working = () => props.chip.tone === "working"
  return (
    <span
      class={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] ${working() ? "bg-[var(--tint-subtle)] text-[var(--accent)]" : faint}`}
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

function Section(props: { title: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="px-2 pt-3" data-component="card-section" data-section={props.title}>
      <div class="flex h-6 items-center justify-between px-2">
        <h3 class="text-[12px] font-medium text-[var(--text-muted)]">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

/** The Add agent menu: the agents not here yet, offered the way the member list offers them. */
function AddAgent(props: { members: readonly Member[] }) {
  const candidates = (): Agent[] => addable(agentList(useApp.agents()), props.members)
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger class={iconButton} aria-label="Add agent" data-action="add-agent">
        <Plus size={15} strokeWidth={1.75} />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-[240px] max-w-[300px]">
          <MenuV2.Group>
            <MenuV2.GroupLabel>Add to this chat</MenuV2.GroupLabel>
            <Show when={candidates().length > 0} fallback={<p class="px-3 pb-2 text-[12px] text-[var(--text-muted)]">Every agent is here. Ask Kiko to make a new one.</p>}>
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

function AgentLine(props: { agent: AgentRow }) {
  return (
    <li class={`${row} min-h-10`} data-member={props.agent.slug}>
      <IdentityAvatar seed={props.agent.slug} size={28} />
      <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{props.agent.name}</span>
      <Show when={props.agent.lead}>
        <span class="shrink-0 rounded-full bg-[var(--selected-bg)] px-1.5 text-[11px] leading-5 text-[var(--text-muted)]" data-component="lead-chip">
          Lead
        </span>
      </Show>
      <StatusChip chip={props.agent.chip} />
      {/* A fixed slot keeps the status chips in one column whether or not the row can be removed. */}
      <Show when={props.agent.removable} fallback={<span class="size-6 shrink-0" aria-hidden="true" />}>
        <MenuV2 gutter={4} placement="bottom-end">
          <MenuV2.Trigger class={tool} aria-label={`${props.agent.name} actions`} data-action="member-actions">
            <Ellipsis size={15} strokeWidth={1.75} />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="min-w-[176px]">
              <MenuV2.Item class="text-danger" data-action="remove-agent" onSelect={() => useApp.memberOp({ op: "remove", slug: props.agent.slug as Member["slug"] })}>
                Remove from chat
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </Show>
    </li>
  )
}

function RoutineLine(props: { routine: Routine; chatId: string; close: () => void }) {
  const active = () => props.routine.status === "active"
  const ran = () => ranNow(props.routine.id)
  const open = () => {
    openSurface(props.chatId, fixedSurface("routines"))
    props.close()
  }
  return (
    <li class={row} data-routine={props.routine.id} data-status={props.routine.status}>
      <button type="button" class="flex min-w-0 flex-1 flex-col py-1.5 text-left" onClick={open}>
        <span class="truncate text-[13px] text-[var(--text)]">{props.routine.name}</span>
        <span class={`truncate text-[11px] ${faint}`}>{ran() ? "Started just now" : `${active() ? "" : "Paused · "}${triggerLabel(props.routine.trigger, props.routine.tz)}`}</span>
      </button>
      <button type="button" class={`${tool} disabled:text-[var(--text-faint)]`} aria-label={ran() ? "Started" : "Run now"} title={ran() ? "Started" : "Run now"} disabled={ran()} data-action="routine-run" onClick={() => void runNow(props.routine)}>
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

function LoopLine(props: { loop: PlateLoop; chatId: string; close: () => void }) {
  const open = () => {
    openSurface(props.chatId, fixedSurface("plate"))
    props.close()
  }
  return (
    <li class={row} data-loop={props.loop.id}>
      <button type="button" class="min-w-0 flex-1 truncate py-1.5 text-left text-[13px] text-[var(--text)]" onClick={open}>
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

/**
 * The chat card for `chatId`. It loads its routines and plate once per open, and it closes itself
 * through `onClose`; the parent decides whether it is shown.
 */
export function CardView(props: { chatId: string; onClose: () => void }) {
  let root: HTMLDivElement | undefined
  let returnTo: Element | null = null
  const location = useLocation()
  const navigate = useNavigate()
  const memory = useMemoryStore()
  const [confirmDelete, setConfirmDelete] = createSignal(false)

  const members = () => useApp.roomMembers()
  const group = () => isGroup(members())
  const chat = () => useApp.chatById(props.chatId)

  const outside = (e: PointerEvent) => {
    const target = e.target
    if (!(target instanceof Element) || root?.contains(target) || target.closest(KEEP_OPEN)) return
    props.onClose()
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return
    props.onClose()
    if (returnTo?.isConnected) (returnTo as HTMLElement).focus()
  }
  const focus = (e: FocusEvent) => {
    if (e.target instanceof Element && e.target.closest('[data-component="composer-dock"]')) props.onClose()
  }

  onMount(() => {
    // Focus moves into the card so Tab reaches its rows. The composer comes earlier in the page, and
    // focus landing there closes the card, so a keyboard user could not get in any other way.
    returnTo = document.activeElement
    root?.focus({ preventScroll: true })
    void loadRoutines()
    void loadLoops()
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", keys)
    document.addEventListener("focusin", focus)
    onCleanup(() => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", keys)
      document.removeEventListener("focusin", focus)
    })
  })
  createEffect(on(() => location.pathname, () => props.onClose(), { defer: true }))
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

  const openMemory = () => {
    openSurface(props.chatId, fixedSurface("memory"))
    props.onClose()
  }
  const openFileRow = (name: string) => {
    openFile(props.chatId, name)
    props.onClose()
  }
  const remove = () => {
    setConfirmDelete(false)
    deleteChat(props.chatId, props.chatId, navigate)
  }

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-no-focus-ring
      class="absolute top-2 right-3 z-30 flex max-h-[calc(100%-24px)] w-[300px] flex-col overflow-hidden rounded-[20px] bg-[var(--menu-bg)] shadow-[0_12px_40px_rgba(0,0,0,.45)] ring-1 ring-[var(--hairline)] ring-inset"
      data-component="chat-card"
    >
      <header class="flex items-center gap-3 px-4 pt-4 pb-3">
        <ChatAvatar faces={useApp.chatFaces(props.chatId)} size={40} />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-[15px] font-semibold text-[var(--text)]" data-component="card-name">
            {chat()?.name ?? "New chat"}
          </span>
          <span class="truncate text-[12px] text-[var(--text-muted)]" data-component="card-live">
            {liveLine(working(), chat()?.updatedAt, Date.now())}
          </span>
        </div>
        <StatusChip chip={statusChip(chat()?.presence)} />
        <Show when={useApp.kikoChatId() !== props.chatId}>
          <MenuV2 gutter={4} placement="bottom-end">
            <MenuV2.Trigger class={iconButton} aria-label="More" data-action="card-more">
              <Ellipsis size={16} strokeWidth={1.75} />
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content class="min-w-[176px]">
                <MenuV2.Item class="text-danger" data-action="delete-chat" onSelect={() => setConfirmDelete(true)}>
                  Delete chat
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </Show>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-none pb-2">
        <Show when={group()}>
          <Section title="Agents" action={<AddAgent members={members()} />}>
            <ul class="flex flex-col gap-px">
              <For each={agents()}>{(agent) => <AgentLine agent={agent} />}</For>
            </ul>
          </Section>
        </Show>

        <Show when={up().routines.length + up().loops.length > 0}>
          <Section title="Coming up">
            <ul class="flex flex-col gap-px">
              <For each={up().routines}>{(r) => <RoutineLine routine={r} chatId={props.chatId} close={props.onClose} />}</For>
              <For each={up().loops}>{(l) => <LoopLine loop={l} chatId={props.chatId} close={props.onClose} />}</For>
            </ul>
          </Section>
        </Show>

        <Show when={files().length > 0}>
          <Section title="Files">
            <ul class="flex flex-col gap-px">
              <For each={files()}>
                {(file) => (
                  <li>
                    <button type="button" class={`${row} w-full text-left`} data-file={file.name} onClick={() => openFileRow(file.name)}>
                      <FileText size={16} strokeWidth={1.75} class="shrink-0 text-[var(--text-muted)]" />
                      <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{file.name}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Section>
        </Show>

        <Show when={lines().length > 0}>
          <Section title="Memory">
            <ul class="flex flex-col gap-px">
              <For each={lines()}>
                {(line) => (
                  <li>
                    <button type="button" class={`${row} w-full py-1.5 text-left`} data-pos={line.pos} onClick={openMemory}>
                      <span class="line-clamp-2 text-[13px] leading-snug text-[var(--text-muted)]">{line.text}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Section>
        </Show>
      </div>

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
            <Button variant="primary" data-action="confirm-delete" onClick={remove}>
              Delete
            </Button>
          </>
        }
      >
        <p class="text-[13px] text-[var(--text-muted)]">Remove this chat and its messages.</p>
      </Dialog>
    </div>
  )
}
