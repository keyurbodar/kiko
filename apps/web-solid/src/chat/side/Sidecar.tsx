import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Bot, Brain, CircleCheck, FileText, FolderOpen, ListChecks, PanelRightClose, Plus, Repeat, X, type LucideProps } from "lucide-solid"
import { type Component, createEffect, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { FileSurface, FilesTree } from "../../files/pane"
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
  closeAll,
  closeOthers,
  closeSidecar,
  closeSurface,
  closeToRight,
  fixedSurface,
  LAUNCHER,
  type LauncherItem,
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
/** Ids are read by the tab's `aria-controls` and the panel's `aria-labelledby`, so they hold no spaces. */
const tabId = (surface: Surface) => `sidecar-tab-${encodeURIComponent(surface.id)}`
const panelId = (surface: Surface) => `sidecar-panel-${encodeURIComponent(surface.id)}`

function labelOf(surface: Surface): string {
  if (surface.kind === "file") return basename(surface.path)
  if (surface.kind === "agent") return roomMembers().find((m) => m.slug === surface.slug)?.name ?? surface.slug
  return LAUNCHER.find((item) => item.kind === surface.kind)?.label ?? ""
}

function Tab(props: { chatId: string; surface: Surface; index: number; count: number; active: boolean; tabbable: boolean }) {
  let el: HTMLDivElement | undefined
  const label = () => labelOf(props.surface)
  const Glyph = ICON[props.surface.kind]
  const activate = () => activateSurface(props.chatId, props.surface.id)
  // A tab that comes to life off the strip scrolls into view.
  createEffect(on(() => props.active, (active) => active && el?.scrollIntoView({ block: "nearest", inline: "nearest" })))
  return (
    <MenuV2.Context gutter={8}>
      <MenuV2.Context.Trigger
        as="div"
        ref={el}
        id={tabId(props.surface)}
        role="tab"
        aria-selected={props.active}
        aria-controls={panelId(props.surface)}
        tabIndex={props.tabbable ? 0 : -1}
        class={`group flex h-8 min-w-0 max-w-48 shrink-0 snap-start cursor-default items-center gap-1 rounded-[10px] pr-1 pl-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          props.active ? "bg-[var(--selected-bg)] text-text" : "text-muted hover:bg-[var(--hover-bg)] hover:text-text"
        }`}
        title={props.surface.kind === "file" ? props.surface.path : undefined}
        data-component="sidecar-tab"
        data-kind={props.surface.kind}
        onClick={activate}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          activate()
        }}
      >
        <Glyph size={16} strokeWidth={1.75} class="shrink-0" aria-hidden="true" />
        <span class="min-w-0 truncate">{label()}</span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${label()}`}
          class={`grid size-5 shrink-0 place-items-center rounded-md text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:opacity-100 ${
            props.active ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
          data-action="close-surface"
          onClick={(e) => {
            e.stopPropagation()
            closeSurface(props.chatId, props.surface.id)
          }}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </MenuV2.Context.Trigger>
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content data-component="sidecar-tab-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
          <MenuV2.Item onSelect={() => closeSurface(props.chatId, props.surface.id)}>Close</MenuV2.Item>
          <MenuV2.Item disabled={props.count < 2} onSelect={() => closeOthers(props.chatId, props.surface.id)}>
            Close others
          </MenuV2.Item>
          <MenuV2.Item disabled={props.index >= props.count - 1} onSelect={() => closeToRight(props.chatId, props.surface.id)}>
            Close to the right
          </MenuV2.Item>
          <MenuV2.Separator />
          <MenuV2.Item onSelect={() => closeAll(props.chatId)}>Close all</MenuV2.Item>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

/** One launcher row. */
function LauncherRow(props: { chatId: string; entry: LauncherItem }) {
  const Glyph = ICON[props.entry.kind]
  return (
    <button
      type="button"
      class="flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm text-text outline-none hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)]"
      data-action={`open-${props.entry.kind}`}
      onClick={() => openSurface(props.chatId, fixedSurface(props.entry.kind))}
    >
      <Glyph size={16} strokeWidth={1.75} class="shrink-0 text-muted" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{props.entry.label}</span>
      <kbd
        class="grid h-5 min-w-5 place-items-center rounded-[5px] bg-[color-mix(in_oklab,var(--text)_14%,transparent)] px-1.5 font-sans text-[13px] font-medium leading-none text-text"
        aria-hidden="true"
      >
        {props.entry.key}
      </kbd>
    </button>
  )
}

function Launcher(props: { chatId: string }) {
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center p-6" data-component="sidecar-launcher">
      <div class="flex w-full max-w-64 flex-col gap-1">
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
  let observer: ResizeObserver | undefined
  // A body fills in after it mounts (a soul card loads), so the saved offset waits until the content is tall enough.
  onMount(() => {
    const saved = scrolls.get(key()) ?? 0
    if (!scroller || !scroller.firstElementChild || saved === 0) return
    const el = scroller
    observer = new ResizeObserver(() => {
      el.scrollTop = saved
      if (el.scrollTop === saved) observer?.disconnect()
    })
    observer.observe(el.firstElementChild!)
    onCleanup(() => observer?.disconnect())
  })
  // A file's viewer and the tree scroll themselves, so only the other bodies scroll here.
  const selfScrolling = props.surface.kind === "file" || props.surface.kind === "files"
  return (
    <div
      ref={scroller}
      id={panelId(props.surface)}
      role="tabpanel"
      aria-labelledby={tabId(props.surface)}
      class={`flex min-h-0 flex-1 flex-col ${selfScrolling ? "overflow-hidden" : "overflow-y-auto overscroll-none"}`}
      data-component="sidecar-body"
      data-kind={props.surface.kind}
      onScroll={(e) => {
        // The user's own scroll wins over a restore that has not landed yet.
        observer?.disconnect()
        scrolls.set(key(), e.currentTarget.scrollTop)
      }}
    >
      <Switch>
        <Match when={props.surface.kind === "files"}>
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
  const group = () => roomMembers().length > 1

  // A letter opens its launcher row, from any tab, while no field has focus. The row focuses its tab if it is open.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return
    if (!sidecarOpen(props.chatId)) return
    const entry = launcherEntries(group()).find((item) => item.key === e.key.toUpperCase())
    if (!entry) return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest(TYPING) || document.activeElement?.closest(TYPING)) return
    if (document.querySelector(OVERLAYS)) return
    e.preventDefault()
    openSurface(props.chatId, fixedSurface(entry.kind))
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  // Arrow keys move between tabs, as the tab pattern asks. Home and End go to the ends.
  const onTablistKey = (e: KeyboardEvent) => {
    const list = surfaces()
    if (list.length === 0) return
    // Move from the tab that has focus, which is the active one unless focus has been moved by hand.
    const focused = (e.target as Element).closest('[role="tab"]')?.id
    const from = list.findIndex((s) => tabId(s) === focused)
    const at = from >= 0 ? from : Math.max(0, list.findIndex((s) => s.id === active()?.id))
    const to = { ArrowRight: (at + 1) % list.length, ArrowLeft: (at - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    activateSurface(props.chatId, list[to]!.id)
    // Focus waits a frame: the body swap in the same tick takes focus again if the tab gets it first.
    requestAnimationFrame(() => document.getElementById(tabId(list[to]!))?.focus())
  }

  // A resize can cut the active tab off, so the strip brings it back, as a tab does when it turns active.
  let strip: HTMLDivElement | undefined
  onMount(() => {
    const observer = new ResizeObserver(() => strip?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }))
    if (strip) observer.observe(strip)
    onCleanup(() => observer.disconnect())
  })

  // A plate or routines tab fetches its list when it shows, and the plate again when the room moves.
  createEffect(on(() => [props.chatId, kind()] as const, ([, k]) => {
    if (k === "plate") void loadLoops()
    if (k === "routines") void loadRoutines()
  }))
  createEffect(on(() => [useApp.room()?.state.seq, useApp.room()?.state.status], () => refreshLoops(), { defer: true }))

  return (
    <aside class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" data-component="sidecar" aria-label="Chat sidecar">
      <header class="flex h-[50px] shrink-0 items-center gap-1 pr-2 pl-2">
        <div
          ref={strip}
          class="flex min-w-0 flex-1 snap-x snap-proximity items-center gap-1 overflow-x-auto scroll-px-2 [mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)] [scrollbar-width:none]"
          role="tablist"
          aria-label="Open surfaces"
          aria-orientation="horizontal"
          onKeyDown={onTablistKey}
        >
          <For each={surfaces()}>
            {(surface, i) => (
              <Tab
                chatId={props.chatId}
                surface={surface}
                index={i()}
                count={surfaces().length}
                active={active()?.id === surface.id}
                tabbable={active()?.id === surface.id || (!active() && i() === 0)}
              />
            )}
          </For>
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
