import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowLeftIcon, CloseIcon } from "@kiko/ui/icons"
import { createEffect, createMemo, For, on, onCleanup, Show, Suspense } from "solid-js"
import { Dynamic } from "solid-js/web"
import { EntryIcon } from "../../lib/EntryIcon"
import { room } from "../../state/room"
import { roomMembers } from "../info/sections"
import DeskOverview from "./card"
import type { FileSurface } from "./desk-nav"
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
        class={`desk-tab group/tab flex h-[30px] max-w-40 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-control pr-1 pl-2 text-label transition-colors duration-(--dur-hover) ${
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
        <span class="flex size-4 shrink-0 items-center justify-center text-micro">
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
      class="desk-tabs flex shrink-0 items-center gap-0.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]"
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

function SurfaceBody(props: { chatId: string; surface: Surface; close: () => void; onExpand?: () => void }) {
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
          close={props.close}
          onExpand={props.onExpand}
        />
      </Suspense>
    </div>
  )
}

const isRailView = (surface: Surface) => ["files", "memory", "routines"].includes(surface.kind)

function Title(props: { text: string }) {
  return (
    <h2 class="min-w-0 flex-1 truncate pl-2 type-label font-medium text-fg" data-component="desk-title">
      {props.text}
    </h2>
  )
}

function DetailHead(props: { chatId: string; surface: Surface }) {
  return (
    <Show when={!isRailView(props.surface)} fallback={<Title text={panelLabel(props.surface)} />}>
      <button
        type="button"
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-control pr-2 pl-1.5 text-label text-[var(--text-300)] transition-[background-color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.97]"
        data-action="desk-back"
        onClick={() => deskBack(props.chatId)}
      >
        <RemixIcon icon={ArrowLeftIcon} size={16} />
        Back
      </button>
      <Title text={panelLabel(props.surface)} />
    </Show>
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

export default function Desk(props: { chatId: string; onClose: () => void; onExpand?: () => void }) {
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
    <aside class="flex h-full min-h-0 w-full min-w-0 overflow-hidden" data-component="sidecar" aria-label="This chat">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show when={view()?.kind !== "files" && view()?.kind !== "file"}>
          <header class="flex h-[52px] shrink-0 items-center gap-2 px-2" data-component="desk-head">
            <Show when={view()} keyed fallback={<Title text="This chat" />}>
              {(surface) => <DetailHead chatId={props.chatId} surface={surface} />}
            </Show>
            <TooltipV2 placement="bottom" openDelay={500} value="Close">
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
        </Show>
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
              <SurfaceBody chatId={props.chatId} surface={surface} close={props.onClose} onExpand={props.onExpand} />
            </div>
          )}
        </Show>
      </div>
    </aside>
  )
}
