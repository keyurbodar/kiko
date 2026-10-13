import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Bot, Brain, CircleCheck, FileText, FolderOpen, ListChecks, PanelRightClose, Plus, Repeat, X, type LucideProps } from "lucide-solid"
import { type Component, createEffect, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { FilesActions, FileSurface, FilesTree } from "../../files/pane"
import { useApp } from "../../lib/store"
import { roomMembers } from "../info/sections"
import { loadLoops, PlatePage, refreshLoops } from "../info/loops"
import { MemoryError, MemoryList, useMemoryStore } from "../info/memory/views"
import { loadRoutines, RoutinesPage } from "../info/routines"
import { TasksView } from "../info/tasks"
import { AgentPage } from "./agent"
import {
  activateSurface,
  activeSurface,
  closeSidecar,
  closeSurface,
  fixedSurface,
  LAUNCHER,
  type LauncherEntry,
  launcherEntries,
  openSurface,
  showLauncher,
  sidecarOpen,
  sidecarSurfaces,
  type Surface,
} from "./surfaces"

/*
 * The right sidecar: one chat's workspace, after t3code's right panel. A tab is one thing open in
 * the chat, and the launcher opens one with its letter. Tabs and bodies answer at once and nothing
 * here animates. Each body scrolls on its own.
 */

type Icon = Component<LucideProps>
type FileTab = Extract<Surface, { kind: "file" }>
type AgentTab = Extract<Surface, { kind: "agent" }>

const ICON: Record<Surface["kind"], Icon> = {
  files: FolderOpen,
  file: FileText,
  memory: Brain,
  plate: CircleCheck,
  routines: Repeat,
  tasks: ListChecks,
  agent: Bot,
}

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]'
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"

/** The scroll of each body, by chat and tab, so a tab comes back where it was left. */
const scrolls = new Map<string, number>()

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)

function labelOf(surface: Surface): string {
  if (surface.kind === "file") return basename(surface.path)
  if (surface.kind === "agent") return roomMembers().find((m) => m.slug === surface.slug)?.name ?? surface.slug
  return LAUNCHER.find((item) => item.kind === surface.kind)?.label ?? ""
}

function Tab(props: { chatId: string; surface: Surface; active: boolean }) {
  let el: HTMLDivElement | undefined
  const label = () => labelOf(props.surface)
  const Glyph = ICON[props.surface.kind]
  // A tab that comes to life off the strip scrolls into view.
  createEffect(on(() => props.active, (active) => active && el?.scrollIntoView({ block: "nearest", inline: "nearest" })))
  return (
    <div
      ref={el}
      role="tab"
      aria-selected={props.active}
      class={`group flex h-8 min-w-0 max-w-48 shrink-0 items-center gap-1 rounded-[10px] pr-1 pl-2 text-[13px] ${
        props.active ? "bg-[var(--selected-bg)] text-text" : "text-muted hover:bg-[var(--hover-bg)] hover:text-text"
      }`}
      data-component="sidecar-tab"
      data-kind={props.surface.kind}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
        title={props.surface.kind === "file" ? props.surface.path : undefined}
        onClick={() => activateSurface(props.chatId, props.surface.id)}
      >
        <Glyph size={16} strokeWidth={1.75} class="shrink-0" aria-hidden="true" />
        <span class="truncate">{label()}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${label()}`}
        class={`grid size-5 shrink-0 place-items-center rounded-md text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:opacity-100 ${
          props.active ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
        data-action="close-surface"
        onClick={() => closeSurface(props.chatId, props.surface.id)}
      >
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  )
}

/** One launcher row. A disabled row is muted and says why in a tooltip. */
function LauncherRow(props: { chatId: string; entry: LauncherEntry }) {
  const Glyph = ICON[props.entry.kind]
  const row = (
    <button
      type="button"
      aria-disabled={props.entry.disabled ? "true" : undefined}
      class={`flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[13px] outline-none ${
        props.entry.disabled ? "cursor-default text-faint" : "text-text hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)]"
      }`}
      data-action={`open-${props.entry.kind}`}
      onClick={() => {
        if (!props.entry.disabled) openSurface(props.chatId, fixedSurface(props.entry.kind))
      }}
    >
      <Glyph size={16} strokeWidth={1.75} class={`shrink-0 ${props.entry.disabled ? "" : "text-muted"}`} aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{props.entry.label}</span>
      <kbd class="grid h-4 min-w-4 place-items-center rounded-[4px] bg-[var(--hover-bg)] px-1 text-[11px] leading-none text-faint" aria-hidden="true">
        {props.entry.key}
      </kbd>
    </button>
  )
  return (
    <Show when={props.entry.disabled} fallback={row}>
      {(reason) => (
        <TooltipV2 placement="bottom" openDelay={400} value={reason()}>
          {row}
        </TooltipV2>
      )}
    </Show>
  )
}

function Launcher(props: { chatId: string }) {
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center p-6" data-component="sidecar-launcher">
      <div class="flex w-full max-w-60 flex-col gap-1">
        <h3 class="pb-2 text-center text-[13px] text-muted">Open a surface</h3>
        <For each={launcherEntries(roomMembers().length > 1)}>{(entry) => <LauncherRow chatId={props.chatId} entry={entry} />}</For>
      </div>
    </div>
  )
}

function MemoryBody() {
  const store = useMemoryStore()
  return (
    <Show when={store()} fallback={<p class="p-2 text-sm text-weak">Loading</p>}>
      {(s) => (
        <div class="flex flex-col gap-3 px-2.5 py-3" data-component="info-memory">
          <MemoryError store={s()} />
          <MemoryList store={s()} />
        </div>
      )}
    </Show>
  )
}

/** The body of one tab. It remounts for each tab, and it keeps its own scroll. */
function SurfaceBody(props: { chatId: string; surface: Surface }) {
  const key = () => `${props.chatId}:${props.surface.id}`
  let scroller: HTMLDivElement | undefined
  queueMicrotask(() => {
    if (scroller) scroller.scrollTop = scrolls.get(key()) ?? 0
  })
  // A file's viewer and the tree scroll themselves, so only the other bodies scroll here.
  const selfScrolling = props.surface.kind === "file" || props.surface.kind === "files"
  return (
    <div
      ref={scroller}
      class={`flex min-h-0 flex-1 flex-col ${selfScrolling ? "overflow-hidden" : "overflow-y-auto overscroll-none"}`}
      data-component="sidecar-body"
      data-kind={props.surface.kind}
      onScroll={(e) => scrolls.set(key(), e.currentTarget.scrollTop)}
    >
      <Switch>
        <Match when={props.surface.kind === "files"}>
          <div class="flex h-10 shrink-0 items-center justify-end gap-1 px-2">
            <FilesActions />
          </div>
          <FilesTree chatId={props.chatId} />
        </Match>
        <Match when={props.surface.kind === "file"}>
          <FileSurface chatId={props.chatId} path={(props.surface as FileTab).path} />
        </Match>
        <Match when={props.surface.kind === "memory"}>
          <MemoryBody />
        </Match>
        <Match when={props.surface.kind === "plate"}>
          <PlatePage chatId={props.chatId} />
        </Match>
        <Match when={props.surface.kind === "routines"}>
          <RoutinesPage chatId={props.chatId} />
        </Match>
        <Match when={props.surface.kind === "tasks"}>
          <div class="px-2.5 pb-3">
            <TasksView />
          </div>
        </Match>
        <Match when={props.surface.kind === "agent"}>
          <AgentPage slug={(props.surface as AgentTab).slug} chatId={props.chatId} onRemoved={() => closeSurface(props.chatId, props.surface.id)} />
        </Match>
      </Switch>
    </div>
  )
}

export default function Sidecar(props: { chatId: string }) {
  const surfaces = () => sidecarSurfaces(props.chatId)
  const active = () => activeSurface(props.chatId)
  const kind = () => active()?.kind

  // Letter keys open the launcher's rows while the launcher shows and no field has focus.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return
    if (active() || !sidecarOpen(props.chatId)) return
    const entry = launcherEntries(roomMembers().length > 1).find((item) => item.key === e.key.toUpperCase())
    if (!entry || entry.disabled) return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest(TYPING) || document.activeElement?.closest(TYPING)) return
    if (document.querySelector(OVERLAYS)) return
    e.preventDefault()
    openSurface(props.chatId, fixedSurface(entry.kind))
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  // A plate or routines tab fetches its list when it shows, and the plate again when the room moves.
  createEffect(on(() => [props.chatId, kind()] as const, ([, k]) => {
    if (k === "plate") void loadLoops()
    if (k === "routines") void loadRoutines()
  }))
  createEffect(on(() => [useApp.room()?.state.seq, useApp.room()?.state.status], () => refreshLoops(), { defer: true }))

  return (
    <aside class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" data-component="sidecar" aria-label="Chat sidecar">
      <header class="flex h-[50px] shrink-0 items-center gap-1 pr-2 pl-2">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Open surfaces">
          <For each={surfaces()}>{(surface) => <Tab chatId={props.chatId} surface={surface} active={active()?.id === surface.id} />}</For>
        </div>
        <TooltipV2 placement="bottom" openDelay={400} value="Open a surface">
          <button type="button" class={ICON_BUTTON} aria-label="Open a surface" data-action="open-launcher" onClick={() => showLauncher(props.chatId)}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </TooltipV2>
        <TooltipV2 placement="bottom" openDelay={400} value="Close sidecar">
          <button type="button" class={ICON_BUTTON} aria-label="Close sidecar" data-action="close-sidecar" onClick={() => closeSidecar(props.chatId)}>
            <PanelRightClose size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </TooltipV2>
      </header>
      <Show when={active()} keyed fallback={<Launcher chatId={props.chatId} />}>
        {(surface) => <SurfaceBody chatId={props.chatId} surface={surface} />}
      </Show>
    </aside>
  )
}
