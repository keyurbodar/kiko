import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Bot, Brain, CircleCheck, FileText, FolderOpen, ListChecks, PanelRightClose, Plus, Repeat, X, type LucideProps } from "lucide-solid"
import { type Component, createEffect, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { EntryIcon } from "../../files/entry-icon"
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
  launcherEntries,
  openSurface,
  sidecarOpen,
  sidecarSurfaces,
  type Surface,
} from "./surfaces"

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
  "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground"

const scrolls = new Map<string, number>()

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)
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
        class={`group/tab flex h-6 min-w-0 max-w-36 shrink-0 snap-start cursor-pointer items-center gap-0.5 rounded-sm pr-2 pl-1.5 text-sm ${
          props.active ? "bg-[var(--accent-strong)] text-foreground" : "text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground"
        }`}
        title={props.surface.kind === "file" ? props.surface.path : undefined}
        data-component="sidecar-tab"
        data-kind={props.surface.kind}
        onClick={activate}
        onAuxClick={(e: MouseEvent) => {
          if (e.button !== 1) return
          e.preventDefault()
          e.stopPropagation()
          closeSurface(props.chatId, props.surface.id)
        }}
        onMouseDown={(e: MouseEvent) => {
          if (e.button === 1) e.preventDefault()
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          activate()
        }}
      >

        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${label()}`}
          class="group/close relative grid size-4 shrink-0 place-items-center rounded-xs text-muted-foreground outline-none hover:bg-[var(--accent)] hover:text-foreground"
          data-action="close-surface"
          onClick={(e) => {
            e.stopPropagation()
            closeSurface(props.chatId, props.surface.id)
          }}
        >
          <span class="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
            <Show when={props.surface.kind === "file" ? (props.surface as FileTab).path : null} fallback={<Glyph size={12} strokeWidth={1.75} class="shrink-0" aria-hidden="true" />}>
              {(path) => <EntryIcon path={path()} size={12} />}
            </Show>
          </span>
          <X size={12} strokeWidth={1.75} class="hidden group-hover/tab:block group-focus-visible/close:block" aria-hidden="true" />
        </button>
        <span class="min-w-0 truncate">{label()}</span>
      </MenuV2.Context.Trigger>
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content class="outline-none" data-component="sidecar-tab-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
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

function Launcher(props: { chatId: string }) {
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center p-6" data-component="sidecar-launcher">
      <div class="flex w-full max-w-60 flex-col gap-0.5">
        <h3 class="mb-3 text-center text-base font-medium text-foreground">Open a surface</h3>
        <For each={launcherEntries(roomMembers().length > 1)}>
          {(entry) => {
            const Glyph = ICON[entry.kind]
            return (
              <button
                type="button"
                class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-md text-foreground hover:bg-accent"
                data-action={`open-${entry.kind}`}
                onClick={() => openSurface(props.chatId, fixedSurface(entry.kind))}
              >
                <Glyph size={16} strokeWidth={1.75} class="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate">{entry.label}</span>
                <kbd class="grid h-5 min-w-5 place-items-center rounded bg-control px-1 font-sans text-xs text-muted-foreground">{entry.key}</kbd>
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function MemoryBody() {
  const store = useMemoryStore()
  return (
    <Show when={store()}>
      {(s) => (
        <div class="flex flex-col gap-3 px-2.5 pb-3" data-component="info-memory">
          <MemoryError store={s()} />
          <MemoryList store={s()} />
        </div>
      )}
    </Show>
  )
}

function SurfaceBody(props: { chatId: string; surface: Surface }) {
  const key = () => `${props.chatId}:${props.surface.id}`
  let scroller: HTMLDivElement | undefined
  let observer: ResizeObserver | undefined
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

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return
    if (!sidecarOpen(props.chatId)) return
    const entry = launcherEntries(group()).find((item) => item.key === e.key.toUpperCase())
    if (!entry) return
    const target = e.composedPath()[0]
    if (target instanceof Element && target.closest(TYPING)) return
    if (document.querySelector(OVERLAYS)) return
    e.preventDefault()
    openSurface(props.chatId, fixedSurface(entry.kind))
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  const onTablistKey = (e: KeyboardEvent) => {
    const list = surfaces()
    if (list.length === 0) return
    const focused = (e.target as Element).closest('[role="tab"]')?.id
    const from = list.findIndex((s) => tabId(s) === focused)
    const at = from >= 0 ? from : Math.max(0, list.findIndex((s) => s.id === active()?.id))
    const to = { ArrowRight: (at + 1) % list.length, ArrowLeft: (at - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    activateSurface(props.chatId, list[to]!.id)
    requestAnimationFrame(() => document.getElementById(tabId(list[to]!))?.focus())
  }

  let strip: HTMLDivElement | undefined
  onMount(() => {
    const observer = new ResizeObserver(() => strip?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }))
    if (strip) observer.observe(strip)
    onCleanup(() => observer.disconnect())
  })

  createEffect(on(() => [props.chatId, kind()] as const, ([, k]) => {
    if (k === "plate") void loadLoops()
    if (k === "routines") void loadRoutines()
  }))
  createEffect(on(() => [useApp.room()?.state.seq, useApp.room()?.state.status], () => refreshLoops(), { defer: true }))

  return (
    <aside class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" data-component="sidecar" aria-label="Chat sidecar">
      <header class="flex h-[50px] shrink-0 items-center gap-1 pr-3 pl-2">

        <div
          ref={strip}
          class="flex min-w-0 flex-1 snap-x snap-proximity items-center gap-1 overflow-x-auto scroll-px-2 [mask-image:linear-gradient(to_right,#000_calc(100%-20px),transparent)] [scrollbar-width:none]"
        >
          <div class="contents" role="tablist" aria-label="Open surfaces" aria-orientation="horizontal" onKeyDown={onTablistKey}>
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
          <MenuV2 gutter={6} placement="bottom-end">
            <TooltipV2 placement="bottom" openDelay={400} value="Open a surface">
              <MenuV2.Trigger class={ICON_BUTTON} aria-label="Open a surface" data-action="open-launcher">
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
              </MenuV2.Trigger>
            </TooltipV2>
            <MenuV2.Portal>
              <MenuV2.Content class="min-w-[220px] outline-none" data-component="sidecar-add-menu" onCloseAutoFocus={(e: Event) => e.preventDefault()}>
                <For each={launcherEntries(group())}>
                  {(entry) => {
                    const Glyph = ICON[entry.kind]
                    return (
                      <MenuV2.Item data-action={`open-${entry.kind}`} shortcut={entry.key} onSelect={() => openSurface(props.chatId, fixedSurface(entry.kind))}>
                        <Glyph size={16} strokeWidth={1.75} class="shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span class="min-w-0 flex-1 truncate">{entry.label}</span>
                      </MenuV2.Item>
                    )
                  }}
                </For>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
        <TooltipV2 placement="bottom" openDelay={400} value="Close sidecar">
          <button type="button" class={ICON_BUTTON} aria-label="Close sidecar" data-action="close-sidecar" onClick={() => closeSidecar(props.chatId)}>
            <PanelRightClose size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </TooltipV2>
      </header>
      <Show when={active()} keyed fallback={<Launcher chatId={props.chatId} />}>
        {(surface) => <SurfaceBody chatId={props.chatId} surface={surface} />}
      </Show>
    </aside>
  )
}
