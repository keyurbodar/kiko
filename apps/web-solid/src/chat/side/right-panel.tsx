import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, MaximizeIcon, MinimizeIcon, PlusIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, Suspense } from "solid-js"
import { Dynamic } from "solid-js/web"
import { EntryIcon } from "../../lib/EntryIcon"
import { room } from "../../state/room"
import { roomMembers } from "../info/sections"
import { launcherEntries, type FixedKind, panelLabel, panelOf, type Surface } from "./panels"
import {
  activateSurface,
  closeAll,
  closeOthers,
  closeSurface,
  closeToRight,
  deskView,
  fixedSurface,
  moveTab,
  openSurface,
  panelMaximized,
  setPanelMaximized,
  showSurfaces,
  surfacesOf,
} from "./surfaces"
import "./right-panel.css"

const scrolls = new Map<string, number>()

const KEY_HINT =
  "type-xs grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-sm bg-quaternary px-1 text-tertiary"

const SHORTCUT_BLOCKING_LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

const TAB_SCROLL_EDGE_TOLERANCE = 1

const typingTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null

function TabIcon(props: { surface: Surface }) {
  return (
    <Show
      when={props.surface.kind === "file"}
      fallback={<RemixIcon icon={panelOf(props.surface.kind).icon} size={12} />}
    >
      <span class="flex text-[10px]">
        <EntryIcon path={(props.surface as Extract<Surface, { kind: "file" }>).path} />
      </span>
    </Show>
  )
}

function Tab(props: { chatId: string; surface: Surface; index: number; count: number; active: boolean }) {
  let el: HTMLDivElement | undefined
  const label = () => panelLabel(props.surface)
  createEffect(
    on(
      () => props.active,
      (active) => active && el?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    ),
  )
  const close = () => closeSurface(props.chatId, props.surface.id)
  return (
    <MenuV2.Context gutter={8}>
      <MenuV2.Context.Trigger
        as="div"
        ref={el}
        role="tab"
        aria-label={label()}
        aria-selected={props.active}
        tabIndex={props.active ? 0 : -1}
        draggable
        class="rp-tab flex h-6 max-w-36 shrink-0 cursor-pointer items-center gap-0.5 rounded-[6px] pr-2 pl-1.5 text-xs"
        title={label()}
        data-component="right-panel-tab"
        data-surface={props.surface.id}
        onClick={() => activateSurface(props.chatId, props.surface.id)}
        onMouseDown={(event: MouseEvent) => event.button === 1 && event.preventDefault()}
        onMouseUp={(event: MouseEvent) => event.button === 1 && event.preventDefault()}
        onAuxClick={(event: MouseEvent) => {
          if (event.button !== 1) return
          event.preventDefault()
          close()
        }}
        onDragStart={(event: DragEvent) => {
          event.dataTransfer?.setData("text/plain", props.surface.id)
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
        }}
        onDragOver={(event: DragEvent) => {
          if (!event.dataTransfer?.types.includes("text/plain")) return
          event.preventDefault()
        }}
        onDrop={(event: DragEvent) => {
          event.preventDefault()
          const from = event.dataTransfer?.getData("text/plain")
          if (from) moveTab(props.chatId, from, props.surface.id)
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          activateSurface(props.chatId, props.surface.id)
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${label()}`}
          class="rp-tab-close relative flex size-4 shrink-0 items-center justify-center rounded-[4px]"
          data-action="close-surface"
          onClick={(event) => {
            event.stopPropagation()
            close()
          }}
        >
          <span class="rp-tab-icon flex size-3 items-center justify-center">
            <TabIcon surface={props.surface} />
          </span>
          <RemixIcon icon={CloseIcon} size={12} class="rp-tab-x" />
        </button>
        <span class="min-w-0 truncate">{label()}</span>
      </MenuV2.Context.Trigger>
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content
          class="outline-none"
          data-component="right-panel-tab-menu"
          onCloseAutoFocus={(event: Event) => event.preventDefault()}
        >
          <MenuV2.Item onSelect={close}>Close</MenuV2.Item>
          <MenuV2.Item disabled={props.count < 2} onSelect={() => closeOthers(props.chatId, props.surface.id)}>
            Close others
          </MenuV2.Item>
          <MenuV2.Item
            disabled={props.index >= props.count - 1}
            onSelect={() => closeToRight(props.chatId, props.surface.id)}
          >
            Close to the right
          </MenuV2.Item>
          <MenuV2.Separator />
          <MenuV2.Item onSelect={() => closeAll(props.chatId)}>Close all</MenuV2.Item>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

function focusTab(id: string) {
  requestAnimationFrame(() => {
    for (const tab of document.querySelectorAll<HTMLElement>('[data-component="right-panel-tab"]')) {
      if (tab.dataset.surface === id) tab.focus()
    }
  })
}

function LauncherItems(props: { onPick: (kind: FixedKind) => void }) {
  const entries = () => launcherEntries(roomMembers().length > 1)
  return (
    <For each={entries()}>
      {(entry) => (
        <MenuV2.Item onSelect={() => props.onPick(entry.kind)}>
          <RemixIcon icon={panelOf(entry.kind).icon} size={14} />
          <span class="min-w-0 flex-1 truncate">{entry.label}</span>
          <span class={KEY_HINT}>{entry.key}</span>
        </MenuV2.Item>
      )}
    </For>
  )
}

function AddSurface(props: { chatId: string }) {
  const [open, setOpen] = createSignal(false)
  const [picked, setPicked] = createSignal<string | null>(null)
  const pick = (kind: FixedKind) => {
    setPicked(kind)
    setOpen(false)
    openSurface(props.chatId, fixedSurface(kind))
  }
  createEffect(() => {
    if (!open()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      const entry = launcherEntries(roomMembers().length > 1).find((item) => item.key === event.key.toUpperCase())
      if (!entry) return
      event.preventDefault()
      event.stopPropagation()
      pick(entry.kind)
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })
  const afterClose = (event: Event) => {
    const id = picked()
    if (id === null) return
    event.preventDefault()
    setPicked(null)
    focusTab(id)
  }
  return (
    <MenuV2 open={open()} onOpenChange={setOpen} placement="bottom-start" gutter={6}>
      <MenuV2.Trigger class="rp-control rp-control-xs" aria-label="Open a surface" data-action="add-surface">
        <RemixIcon icon={PlusIcon} class="size-3.5" />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-52" data-component="right-panel-launcher" onCloseAutoFocus={afterClose}>
          <LauncherItems onPick={pick} />
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function wheelToScroll(strip: HTMLDivElement, event: WheelEvent) {
  if (event.ctrlKey) return
  let delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= strip.clientWidth
  if (delta === 0) return
  const before = strip.scrollLeft
  strip.scrollLeft += delta
  if (strip.scrollLeft !== before) event.preventDefault()
}

function ScrollButton(props: { direction: -1 | 1; disabled: boolean; onScroll: () => void }) {
  const label = props.direction < 0 ? "Scroll tabs left" : "Scroll tabs right"
  return (
    <TooltipV2 placement="bottom" openDelay={400} value={label}>
      <button
        type="button"
        class="rp-control rp-control-xs"
        aria-label={label}
        disabled={props.disabled}
        onClick={() => props.onScroll()}
      >
        <RemixIcon icon={props.direction < 0 ? ChevronLeftIcon : ChevronRightIcon} class="size-3.5" />
      </button>
    </TooltipV2>
  )
}

function TabStrip(props: { chatId: string }) {
  const surfaces = () => surfacesOf(props.chatId)
  const active = () => deskView(props.chatId)?.id ?? null
  let strip: HTMLDivElement | undefined
  const [scroll, setScroll] = createSignal({ overflow: false, left: false, right: false, fade: "" })
  const measure = () => {
    if (!strip) return
    const max = strip.scrollWidth - strip.clientWidth
    const at = strip.scrollLeft
    const overflow = max > TAB_SCROLL_EDGE_TOLERANCE
    const left = overflow && at > TAB_SCROLL_EDGE_TOLERANCE
    const right = overflow && at < max - TAB_SCROLL_EDGE_TOLERANCE
    setScroll({ overflow, left, right, fade: [left ? "start" : "", right ? "end" : ""].filter(Boolean).join(" ") })
  }
  const scrollTabs = (direction: -1 | 1) => {
    if (!strip) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    strip.scrollBy({ left: direction * Math.max(120, strip.clientWidth * 0.75), behavior: reduce ? "auto" : "smooth" })
  }
  createEffect(on(surfaces, () => queueMicrotask(measure)))
  const onKey = (event: KeyboardEvent) => {
    const list = surfaces()
    const at = Math.max(
      0,
      list.findIndex((surface) => surface.id === active()),
    )
    const to = { ArrowRight: (at + 1) % list.length, ArrowLeft: (at - 1 + list.length) % list.length }[event.key]
    if (to === undefined || list.length === 0) return
    event.preventDefault()
    activateSurface(props.chatId, list[to]!.id)
  }
  return (
    <>
      <div
        ref={(el) => {
          strip = el
          const observer = new ResizeObserver(measure)
          observer.observe(el)
          const onWheel = (event: WheelEvent) => wheelToScroll(el, event)
          el.addEventListener("wheel", onWheel, { passive: false })
          onCleanup(() => {
            observer.disconnect()
            el.removeEventListener("wheel", onWheel)
          })
          queueMicrotask(measure)
        }}
        class="rp-tabs min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
        data-component="right-panel-tabs"
        data-fade={scroll().fade}
        onScroll={measure}
      >
        <div class="flex h-full w-max min-w-full items-center gap-1">
          <div class="flex items-center gap-1" role="tablist" aria-label="Open panels" onKeyDown={onKey}>
            <For each={surfaces()}>
              {(surface, index) => (
                <Tab
                  chatId={props.chatId}
                  surface={surface}
                  index={index()}
                  count={surfaces().length}
                  active={surface.id === active()}
                />
              )}
            </For>
          </div>
          <AddSurface chatId={props.chatId} />
        </div>
      </div>
      <Show when={scroll().overflow}>
        <div class="flex shrink-0 items-center gap-0.5" role="group" aria-label="Scroll panel tabs">
          <ScrollButton direction={-1} disabled={!scroll().left} onScroll={() => scrollTabs(-1)} />
          <ScrollButton direction={1} disabled={!scroll().right} onScroll={() => scrollTabs(1)} />
        </div>
      </Show>
    </>
  )
}

function EmptyPanel(props: { chatId: string }) {
  const entries = () => launcherEntries(roomMembers().length > 1)
  const [highlight, setHighlight] = createSignal(-1)
  const at = () => (entries().length === 0 ? -1 : Math.min(highlight(), entries().length - 1))
  const open = (kind: FixedKind) => openSurface(props.chatId, fixedSurface(kind))
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      const entry = entries().find((item) => item.key.toLowerCase() === event.key.toLowerCase())
      if (!entry || document.querySelector(SHORTCUT_BLOCKING_LAYERS)) return
      if (typingTarget(event.composedPath()[0] ?? event.target)) return
      event.preventDefault()
      event.stopPropagation()
      open(entry.kind)
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    const count = entries().length
    if (count === 0) return
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault()
      setHighlight((at() + 1) % count)
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault()
      setHighlight(at() === -1 ? count - 1 : (at() - 1 + count) % count)
      return
    }
    if (event.key !== "Enter" || event.target !== event.currentTarget) return
    const entry = entries()[at()]
    if (!entry) return
    event.preventDefault()
    open(entry.kind)
  }
  return (
    <div
      ref={(el) => queueMicrotask(() => !typingTarget(document.activeElement) && el.focus())}
      tabIndex={0}
      aria-label="Open a surface"
      class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-[60px] outline-none"
      data-component="right-panel-empty"
      onKeyDown={onKeyDown}
    >
      <div class="w-full max-w-xs py-6">
        <h3 class="mb-3 text-center text-[13px] text-[var(--text-primary)]">Open a surface</h3>
        <div class="flex flex-col gap-0.5">
          <For each={entries()}>
            {(entry, index) => (
              <button
                type="button"
                class="rp-launch flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-[var(--text-primary)]"
                data-highlighted={at() === index() ? "" : undefined}
                data-action={`open-${entry.kind}`}
                onMouseEnter={() => setHighlight(index())}
                onMouseLeave={() => setHighlight((current) => (current === index() ? -1 : current))}
                onClick={() => open(entry.kind)}
              >
                <RemixIcon icon={panelOf(entry.kind).icon} size={14} class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{entry.label}</span>
                <span class={KEY_HINT}>{entry.key}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

function SurfaceBody(props: { chatId: string; surface: Surface }) {
  const key = `${props.chatId}:${props.surface.id}`
  let scroller: HTMLDivElement | undefined
  let observer: ResizeObserver | undefined
  const saved = scrolls.get(key) ?? 0
  const restore = (el: HTMLDivElement) => {
    scroller = el
    const target = el.firstElementChild
    if (!target || saved === 0) return
    observer = new ResizeObserver(() => {
      el.scrollTop = saved
      if (el.scrollTop === saved) observer?.disconnect()
    })
    observer.observe(target)
  }
  onCleanup(() => observer?.disconnect())
  const entry = panelOf(props.surface.kind)
  return (
    <div
      ref={(el) => queueMicrotask(() => restore(el))}
      class={`flex min-h-0 flex-1 flex-col ${entry.selfScrolling ? "overflow-hidden" : "overflow-y-auto overscroll-contain"}`}
      data-component="right-panel-body"
      data-kind={props.surface.kind}
      onScroll={(event) => {
        observer?.disconnect()
        if (event.currentTarget === scroller) scrolls.set(key, event.currentTarget.scrollTop)
      }}
    >
      <Suspense>
        <Dynamic
          component={entry.component}
          chatId={props.chatId}
          surface={props.surface as never}
          close={() => showSurfaces(props.chatId)}
        />
      </Suspense>
    </div>
  )
}

function PanelControls(props: { chatId: string; onClose: () => void; sheet: boolean }) {
  const maximized = () => panelMaximized()
  return (
    <div class="flex shrink-0 items-center gap-0.5" data-component="right-panel-controls">
      <Show when={!props.sheet}>
        <TooltipV2 placement="bottom" openDelay={400} value={maximized() ? "Restore panel" : "Maximize panel"}>
          <button
            type="button"
            class="rp-control"
            aria-label={maximized() ? "Restore panel" : "Maximize panel"}
            aria-pressed={maximized()}
            data-action="toggle-panel-max"
            onClick={() => setPanelMaximized(!maximized())}
          >
            <RemixIcon icon={maximized() ? MinimizeIcon : MaximizeIcon} size={14} />
          </button>
        </TooltipV2>
      </Show>
      <TooltipV2 placement="bottom" openDelay={400} value="Close">
        <button
          type="button"
          class="rp-control"
          aria-label="Close panel"
          data-action="close-panel"
          onClick={props.onClose}
        >
          <RemixIcon icon={CloseIcon} size={14} />
        </button>
      </TooltipV2>
    </div>
  )
}

export default function RightPanel(props: { chatId: string; onClose: () => void; sheet?: boolean }) {
  const view = () => deskView(props.chatId)
  const slot = createMemo(() => {
    const surface = view()
    return surface?.kind === "file" ? "file" : (surface?.id ?? null)
  })
  const maximized = () => panelMaximized() && !props.sheet
  createEffect(() => {
    const members = room.roomMembers()
    const current = view()
    if (members.length === 0 || current?.kind !== "agent") return
    if (!members.some((member) => member.slug === current.slug)) closeSurface(props.chatId, current.id)
  })
  return (
    <aside
      class="rp-panel flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
      data-component="right-panel"
      data-maximized={maximized() ? "" : undefined}
      data-panel-mode={props.sheet ? "sheet" : "inline"}
      aria-label="Chat panels"
    >
      <header class="rp-head flex shrink-0 items-center gap-1 pr-3 pl-2" data-component="right-panel-head">
        <TabStrip chatId={props.chatId} />
        <PanelControls chatId={props.chatId} onClose={props.onClose} sheet={props.sheet === true} />
      </header>
      <Show when={slot()} keyed fallback={<EmptyPanel chatId={props.chatId} />}>
        <SurfaceBody chatId={props.chatId} surface={view()!} />
      </Show>
    </aside>
  )
}
