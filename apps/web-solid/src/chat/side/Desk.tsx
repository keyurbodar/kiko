import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowLeftIcon, CloseIcon } from "@kiko/ui/icons"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, Suspense } from "solid-js"
import { Dynamic } from "solid-js/web"
import { EntryIcon } from "../../lib/EntryIcon"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import { room } from "../../state/room"
import { roomMembers } from "../info/sections"
import DeskOverview from "./card"
import type { FileSurface } from "./desk-nav"
import { isGroup, liveLine } from "./overview-model"
import { launcherEntries, panelLabel, panelOf } from "./panels"
import {
  activateSurface,
  closeOthers,
  closeSurface,
  closeTabs,
  closeToRight,
  deskBack,
  deskView,
  fixedSurface,
  openFiles,
  openSurface,
  type Surface,
} from "./surfaces"
import "./card.css"

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]'
const ICON_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-control text-fg2 transition-[background-color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.97]"

const scrolls = new Map<string, number>()

const level = (id: string | null) => (id === null ? 0 : id.startsWith("file:") ? 2 : 1)

function Tab(props: { chatId: string; file: FileSurface; index: number; count: number; active: boolean }) {
  let el: HTMLDivElement | undefined
  const label = () => panelLabel(props.file)
  const activate = () => activateSurface(props.chatId, props.file.id)
  createEffect(
    on(
      () => props.active,
      (active) => active && el?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    ),
  )
  return (
    <MenuV2.Context gutter={8}>
      <MenuV2.Context.Trigger
        as="div"
        ref={el}
        role="tab"
        aria-selected={props.active}
        tabIndex={props.active ? 0 : -1}
        class={`desk-tab group/tab flex h-7 max-w-40 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-control pr-1 pl-2 text-label transition-colors duration-(--dur-hover) ${
          props.active ? "bg-active text-fg" : "text-fg3 hover:bg-hover hover:text-fg"
        }`}
        title={label()}
        data-component="sidecar-tab"
        data-kind="file"
        onClick={activate}
        onAuxClick={(e: MouseEvent) => {
          if (e.button !== 1) return
          e.preventDefault()
          closeSurface(props.chatId, props.file.id)
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          activate()
        }}
      >
        <span class="flex size-3.5 shrink-0 items-center justify-center text-[10px]">
          <EntryIcon path={props.file.path} />
        </span>
        <span class="min-w-0 truncate">{label()}</span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${label()}`}
          class="desk-tab-close grid size-5 shrink-0 place-items-center rounded-check text-fg3 hover:bg-hover hover:text-fg"
          data-action="close-surface"
          onClick={(e) => {
            e.stopPropagation()
            closeSurface(props.chatId, props.file.id)
          }}
        >
          <RemixIcon icon={CloseIcon} size={12} />
        </button>
      </MenuV2.Context.Trigger>
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content
          class="outline-none"
          data-component="sidecar-tab-menu"
          onCloseAutoFocus={(e: Event) => e.preventDefault()}
        >
          <MenuV2.Item onSelect={() => closeSurface(props.chatId, props.file.id)}>Close</MenuV2.Item>
          <MenuV2.Item disabled={props.count < 2} onSelect={() => closeOthers(props.chatId, props.file.id)}>
            Close others
          </MenuV2.Item>
          <MenuV2.Item
            disabled={props.index >= props.count - 1}
            onSelect={() => closeToRight(props.chatId, props.file.id)}
          >
            Close to the right
          </MenuV2.Item>
          <MenuV2.Separator />
          <MenuV2.Item onSelect={() => closeTabs(props.chatId)}>Close all</MenuV2.Item>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

function Tabs(props: { chatId: string; active: string }) {
  const files = () => openFiles(props.chatId)
  const onKey = (e: KeyboardEvent) => {
    const list = files()
    const at = Math.max(
      0,
      list.findIndex((f) => f.id === props.active),
    )
    const to = { ArrowRight: (at + 1) % list.length, ArrowLeft: (at - 1 + list.length) % list.length }[e.key]
    if (to === undefined) return
    e.preventDefault()
    activateSurface(props.chatId, list[to]!.id)
  }
  return (
    <div
      class="desk-tabs flex shrink-0 items-center gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none]"
      role="tablist"
      aria-label="Open files"
      onKeyDown={onKey}
    >
      <For each={files()}>
        {(file, i) => (
          <Tab chatId={props.chatId} file={file} index={i()} count={files().length} active={file.id === props.active} />
        )}
      </For>
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
      data-component="sidecar-body"
      data-kind={props.surface.kind}
      onScroll={(e) => {
        observer?.disconnect()
        if (e.currentTarget === scroller) scrolls.set(key, e.currentTarget.scrollTop)
      }}
    >
      <Suspense>
        <Dynamic
          component={entry.component}
          chatId={props.chatId}
          surface={props.surface as never}
          close={() => deskBack(props.chatId)}
        />
      </Suspense>
    </div>
  )
}

function OverviewHead(props: { chatId: string }) {
  const chat = () => room.chatById(props.chatId)
  const members = () => room.roomMembers()
  const [clock, setClock] = createSignal(Date.now())
  const ticker = setInterval(() => setClock(Date.now()), 30_000)
  onCleanup(() => clearInterval(ticker))
  const working = () => {
    const row = chat()
    return row && row.presence !== "idle" ? (row.typing ?? null) : null
  }
  return (
    <div class="flex min-w-0 flex-1 items-center gap-2.5 pl-2">
      <ChatAvatar faces={room.chatFaces(props.chatId)} size={32} />
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate type-row text-fg" data-component="card-name">
          {chat()?.name ?? ""}
        </span>
        <span
          class={`truncate text-label ${working() ? "desk-shimmer text-fg" : "text-fg3"}`}
          data-component="card-live"
        >
          {working() ??
            (isGroup(members())
              ? members()
                  .map((m) => m.name)
                  .join(", ")
              : liveLine(null, chat(), clock()))}
        </span>
      </div>
    </div>
  )
}

function DetailHead(props: { chatId: string; surface: Surface }) {
  return (
    <>
      <button
        type="button"
        class="flex h-control shrink-0 items-center gap-1.5 rounded-control pr-2.5 pl-2 text-ui text-fg2 transition-[background-color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.97]"
        data-action="desk-back"
        onClick={() => deskBack(props.chatId)}
      >
        <RemixIcon icon={ArrowLeftIcon} size={16} />
        Back
      </button>
      <h2 class="min-w-0 flex-1 truncate px-1 type-row text-fg" data-component="desk-title">
        {panelLabel(props.surface)}
      </h2>
    </>
  )
}

function useLauncherKeys(chatId: () => string) {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return
    const entry = launcherEntries(roomMembers().length > 1).find((item) => item.key === e.key.toUpperCase())
    if (!entry) return
    const target = e.composedPath()[0]
    if (target instanceof Element && target.closest(TYPING)) return
    if (document.querySelector(OVERLAYS)) return
    e.preventDefault()
    openSurface(chatId(), fixedSurface(entry.kind))
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))
}

export default function Desk(props: { chatId: string; onClose: () => void }) {
  const view = () => deskView(props.chatId)
  const step = createMemo<{ id: string | null; dir: "in" | "back" | undefined }>(
    (prev) => {
      const id = view()?.id ?? null
      if (id === prev.id) return prev
      const moved = level(id) - level(prev.id)
      return { id, dir: moved < 0 ? "back" : moved > 0 ? "in" : undefined }
    },
    { id: view()?.id ?? null, dir: undefined },
  )

  createEffect(() => {
    const members = room.roomMembers()
    const current = view()
    if (members.length === 0 || current?.kind !== "agent") return
    if (!members.some((m) => m.slug === current.slug)) deskBack(props.chatId)
  })

  useLauncherKeys(() => props.chatId)

  return (
    <aside
      class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
      data-component="sidecar"
      aria-label="This chat"
    >
      <header class="flex min-h-14 shrink-0 items-center gap-1 px-2 py-2" data-component="desk-head">
        <Show when={view()} keyed fallback={<OverviewHead chatId={props.chatId} />}>
          {(surface) => <DetailHead chatId={props.chatId} surface={surface} />}
        </Show>
        <TooltipV2 placement="bottom" openDelay={400} value="Close">
          <button
            type="button"
            class={ICON_BUTTON}
            aria-label="Close chat details"
            data-action="close-desk"
            onClick={() => props.onClose()}
          >
            <RemixIcon icon={CloseIcon} size={16} />
          </button>
        </TooltipV2>
      </header>
      <Show when={view()?.kind === "file" && openFiles(props.chatId).length > 1}>
        <Tabs chatId={props.chatId} active={view()!.id} />
      </Show>
      <Show
        when={view()}
        keyed
        fallback={
          <div class="desk-push flex min-h-0 flex-1 flex-col" data-dir={step().dir}>
            <DeskOverview chatId={props.chatId} />
          </div>
        }
      >
        {(surface) => (
          <div class="desk-push flex min-h-0 flex-1 flex-col" data-dir={step().dir}>
            <SurfaceBody chatId={props.chatId} surface={surface} />
          </div>
        )}
      </Show>
    </aside>
  )
}
