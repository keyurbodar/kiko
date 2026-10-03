import { createEffect, createMemo, For, lazy, Match, on, onCleanup, Show, Suspense, Switch } from "solid-js"
import { openTasks, TasksView } from "./tasks"
import { useCommands } from "../../commands/registry"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { openBirdPicker } from "../../mascot/picker-state"
import { useApp } from "../../lib/store"
import { chatModel, setChatModel } from "../../settings/chat-model"
import { ModelList } from "../../settings/model-picker"
import { createCatalog } from "./catalog"
import { LinksList, MediaCard, MediaList } from "./lists"
import { MemoryError, MemoryList, RecordView, useMemoryStore } from "./memory/views"
import { Card, DeleteChat, flat, Header, ICON, ListRow, Members, QuickActions, roomMembers } from "./sections"
import {
  closeFile,
  closeInfo,
  FILE_MAX_WIDTH,
  FILE_MIN_WIDTH,
  type InfoTab,
  type InfoView,
  infoDepth,
  infoSections,
  infoTab,
  infoView,
  MAX_WIDTH,
  MIN_WIDTH,
  openFilePath,
  panelWidth,
  popInfo,
  pushInfo,
  resetInfo,
  setFileWidth,
  setInfoTab,
  setInfoWidth,
} from "./state"

const count = (n: number) => (n ? String(n) : "")

// The files tab is its own chunk: the tree and the viewers load when the tab first opens.
const loadFiles = () => import("../../files/pane")
const FilesPane = lazy(loadFiles)
const FilesActions = lazy(() => loadFiles().then((m) => ({ default: m.FilesActions })))
const TABS: readonly InfoTab[] = ["info", "files"]

/*
 * The chat info panel: everything about one chat behind one click on its name. It is the
 * right-hand column of the shell, 360 px by default and resizable by its left edge. The
 * shell loads this file on the first open, so the chat route does not carry it.
 *
 * Each card opens its full list inside the panel, and the back arrow returns. Nothing here
 * animates. The panel stays mounted across chats, and the scroll position of each chat's view
 * is kept, so coming back to a chat finds its panel where it was left.
 */

const scrolls = new Map<string, number>()

const TITLES: Record<InfoView["kind"], string> = {
  home: "chat info",
  memory: "memory",
  record: "memory",
  links: "links",
  media: "media",
  agent: "agent",
  model: "model",
  tasks: "tasks",
}

function AgentCard(props: { slug: string; chatId: string }) {
  const member = () => roomMembers().find((m) => m.slug === props.slug)
  const status = () => useApp.room()?.state.status[props.slug as never] ?? "idle"
  return (
    <div class="flex flex-col gap-3" data-component="info-agent" data-slug={props.slug}>
      <div class="flex flex-col items-center gap-2 pt-2">
        <button
          type="button"
          class="rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          aria-label="change bird"
          title="change bird"
          data-action="change-bird"
          onClick={() => openBirdPicker(props.slug)}
        >
          <IdentityAvatar seed={props.slug} size={72} state={status() === "working" ? "working" : status() === "typing" ? "typing" : undefined} />
        </button>
        <h2 class="text-lg font-medium text-text">{member()?.name ?? props.slug}</h2>
      </div>
      <Card id="agent-facts" title="details">
        <dl class="flex flex-col gap-1 px-2 py-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-weak">role</dt>
            <dd data-field="role">{member()?.lead ? "lead" : "agent"}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-weak">model</dt>
            <dd class="truncate" data-field="model">
              {chatModel(props.chatId)?.split("/").slice(1).join("/") ?? "none"}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-weak">status</dt>
            <dd data-field="status">{status()}</dd>
          </div>
        </dl>
      </Card>
      <Show when={member()}>
        {(m) => (
          <div class="flex gap-2">
            <button
              type="button"
              class="h-8 rounded-lg bg-btn px-3 text-sm text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))] disabled:opacity-40"
              disabled={roomMembers().length < 2}
              data-action="remove-agent"
              onClick={() => {
                useApp.memberOp({ op: "remove", slug: m().slug })
                popInfo()
              }}
            >
              remove
            </button>
          </div>
        )}
      </Show>
    </div>
  )
}

function Home(props: { chatId: string; links: ReturnType<typeof createCatalog>; media: ReturnType<typeof createCatalog> }) {
  const members = roomMembers
  const memory = useMemoryStore()
  const memoryCount = () => count(memory()?.state.records.filter((r) => !r.archived).length ?? 0)
  const extras = createMemo(() => infoSections().filter((s) => !s.when || s.when(props.chatId)))
  return (
    <div class="flex flex-col gap-3" data-component="info-home">
      <Header chatId={props.chatId} members={members()} />
      <QuickActions chatId={props.chatId} />
      <Members members={members()} />
      <Show when={props.media.items().length}>
        <MediaCard catalog={props.media} />
      </Show>
      <div class={`${flat} flex flex-col p-1`} data-component="info-shared">
        <ListRow id="model" label="model" hue={265} path={ICON.model} value={chatModel(props.chatId)?.split("/").slice(1).join("/") ?? "choose"} onClick={() => pushInfo({ kind: "model" })} />
        <ListRow id="memory" label="memory" hue={330} path={ICON.memory} value={memoryCount()} onClick={() => pushInfo({ kind: "memory" })} />
        <ListRow id="media" label="photos and videos" hue={150} path={ICON.media} value={count(props.media.items().length)} onClick={() => pushInfo({ kind: "media" })} />
        <ListRow id="files" label="files" hue={210} path={ICON.files} value={count(useApp.activeFiles().length)} onClick={() => setInfoTab("files")} />
        <Show when={roomMembers().length > 1}>
          <ListRow id="tasks" label="tasks" hue={185} path={ICON.files} value={count(openTasks(useApp.room()?.tasks() ?? []).length)} onClick={() => pushInfo({ kind: "tasks" })} />
        </Show>
        <ListRow id="links" label="links" hue={45} path={ICON.links} value={count(props.links.items().filter((i) => i.kind === "link").length)} onClick={() => pushInfo({ kind: "links" })} />
      </div>
      <For each={extras()}>
        {(section) => (
          <Card id={section.id} title={section.title}>
            {section.render(props.chatId)}
          </Card>
        )}
      </For>
      <DeleteChat chatId={props.chatId} />
    </div>
  )
}

function MemoryViews(props: { view: Extract<InfoView, { kind: "memory" | "record" }> }) {
  const store = useMemoryStore()
  return (
    <Show when={store()} fallback={<p class="p-2 text-sm text-weak">loading</p>}>
      {(s) => (
        <div class="flex flex-col gap-3" data-component="info-memory">
          <MemoryError store={s()} />
          <Switch>
            <Match when={props.view.kind === "record" && props.view}>
              {(view) => {
                const record = () => s().get((view() as { id: string }).id)
                return (
                  <Show
                    when={record()}
                    fallback={<p class="p-2 text-sm text-weak">{s().state.loaded ? "that record is gone" : "loading"}</p>}
                  >
                    {(r) => <RecordView record={r()} store={s()} onOpen={(id) => pushInfo({ kind: "record", id })} onGone={popInfo} />}
                  </Show>
                )
              }}
            </Match>
            <Match when={true}>
              <MemoryList store={s()} onOpen={(id) => pushInfo({ kind: "record", id })} />
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  )
}

function Back() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 3L5 8l5 5" />
    </svg>
  )
}


/** Drag the left edge. An open file has its own, wider width, so closing it restores the narrow one. */
function Resizer(props: { chatId: string }) {
  const wide = () => infoTab() === "files" && openFilePath(props.chatId) !== null
  let start: { x: number; width: number; wide: boolean } | null = null
  const move = (event: PointerEvent) => {
    if (!start) return
    // The panel is on the right, so dragging left makes it wider.
    const next = start.width + (start.x - event.clientX)
    if (start.wide) setFileWidth(next)
    else setInfoWidth(next)
  }
  const stop = () => {
    start = null
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", stop)
  }
  onCleanup(stop)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="resize panel"
      aria-valuemin={wide() ? FILE_MIN_WIDTH : MIN_WIDTH}
      aria-valuemax={wide() ? FILE_MAX_WIDTH : MAX_WIDTH}
      aria-valuenow={panelWidth(props.chatId)}
      data-component="info-resizer"
      class="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-[var(--tab-bg-hover)]"
      onPointerDown={(event) => {
        start = { x: event.clientX, width: panelWidth(props.chatId), wide: wide() }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", stop)
        event.preventDefault()
      }}
    />
  )
}

const iconButton = "grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--hover-bg)] hover:text-text"

/*
 * The chat's right panel: two tabs, info and files, after t3code's right panel. The tab row is
 * the top bar's height, so the panel and the transcript line up. The panel is a fill, not a
 * border: kat separates with fill or shadow. Nothing here animates.
 */
export default function InfoPanel(props: { chatId: string }) {
  // Escape steps back one level: an open file closes to its tree, then the panel closes. It is a
  // command like every shortcut, and a dialog above the panel (the media viewer, a picker) keeps
  // its own Escape. Whether a dialog was open is read before anyone handles the key, because the
  // dialog closes itself on the same keydown, before this command runs.
  const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  let dialogOnKey = false
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dialogOnKey = !!document.querySelector(DIALOG)
  }
  window.addEventListener("keydown", onKey, true)
  onCleanup(() => window.removeEventListener("keydown", onKey, true))
  useCommands([
    {
      id: "chat.info-close",
      title: "chat: close panel",
      group: "chat",
      icon: "close",
      shortcut: "Escape",
      passive: true,
      run: () => {
        if (dialogOnKey || document.querySelector(DIALOG)) return
        if (infoTab() === "files" && openFilePath(props.chatId)) closeFile(props.chatId)
        else closeInfo()
      },
    },
  ])
  const links = createCatalog("links")
  const media = createCatalog("media")
  let scroller: HTMLDivElement | undefined
  const key = () => `${props.chatId}:${infoView().kind}`

  // A different chat opens on its home card, at the scroll it was left at. A chat never seen
  // keeps the scroll the reader already has.
  createEffect(on(() => props.chatId, () => resetInfo(), { defer: true }))
  createEffect(
    on(key, (k) => {
      const saved = scrolls.get(k)
      queueMicrotask(() => {
        if (!scroller) return
        if (saved !== undefined) scroller.scrollTop = saved
        else if (infoView().kind !== "home") scroller.scrollTop = 0
      })
    }),
  )

  const view = infoView
  // Beside the chat the panel leaves the chat at least 400 px. Below 760 px it covers the chat instead.
  return (
    <aside
      class="relative flex min-h-0 shrink-0 flex-col bg-[var(--bg-sidebar)] @min-[761px]/main:max-w-[calc(100%-400px)] @max-[760px]/main:absolute @max-[760px]/main:inset-y-0 @max-[760px]/main:right-0 @max-[760px]/main:z-30 @max-[760px]/main:shadow-[-12px_0_32px_rgb(0_0_0/0.35)]"
      style={{ width: `min(${panelWidth(props.chatId)}px, 100%)` }}
      data-component="info-panel"
      data-tab={infoTab()}
      aria-label="chat panel"
    >
      <Resizer chatId={props.chatId} />
      <div class="flex h-[50px] shrink-0 items-center gap-1 pr-2 pl-3">
        <div class="flex min-w-0 flex-1 items-center gap-1" role="tablist" aria-label="panel" data-component="info-tabs">
          <For each={TABS}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                class="h-7 rounded-lg px-2.5 text-[13px] font-medium text-muted hover:text-text aria-selected:bg-[var(--selected-bg)] aria-selected:text-text"
                aria-selected={infoTab() === tab}
                data-tab={tab}
                onClick={() => setInfoTab(tab)}
              >
                {tab}
              </button>
            )}
          </For>
        </div>
        <Show when={infoTab() === "files"}>
          <Suspense>
            <FilesActions />
          </Suspense>
        </Show>
        <button type="button" class={iconButton} data-action="close" aria-label="close panel" title="close panel" onClick={() => closeInfo()}>
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M1 1l6 6M7 1L1 7" />
          </svg>
        </button>
      </div>
      <Switch>
        <Match when={infoTab() === "files"}>
          <div class="flex min-h-0 flex-1 flex-col" role="tabpanel" data-component="info-files-tab">
            <Suspense>
              <FilesPane chatId={props.chatId} />
            </Suspense>
          </div>
        </Match>
        <Match when={infoTab() === "info"}>
          <Show when={infoDepth() > 1}>
            <div class="flex h-10 shrink-0 items-center gap-1 px-2">
              <button type="button" class={iconButton} data-action="back" aria-label="back" onClick={() => popInfo()}>
                <Back />
              </button>
              <h2 class="min-w-0 flex-1 truncate text-[13px] font-medium text-muted" data-component="info-title">
                {TITLES[view().kind]}
              </h2>
            </div>
          </Show>
          <div
            ref={scroller}
            class="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
            role="tabpanel"
            data-component="info-scroll"
            onScroll={(event) => scrolls.set(key(), event.currentTarget.scrollTop)}
          >
            <Switch>
              <Match when={view().kind === "home"}>
                <Home chatId={props.chatId} links={links} media={media} />
              </Match>
              <Match when={view().kind === "memory" || view().kind === "record"}>
                <MemoryViews view={view() as never} />
              </Match>
              <Match when={view().kind === "links"}>
                <LinksList catalog={links} />
              </Match>
              <Match when={view().kind === "media"}>
                <MediaList catalog={media} />
              </Match>
              <Match when={view().kind === "agent"}>
                <AgentCard slug={(view() as { slug: string }).slug} chatId={props.chatId} />
              </Match>
              <Match when={view().kind === "tasks"}>
                <TasksView />
              </Match>
              <Match when={view().kind === "model"}>
                <div class="flex h-[min(560px,70dvh)] flex-col" data-component="info-model-list">
                  <ModelList current={chatModel(props.chatId)} onPick={(ref) => (setChatModel(props.chatId, ref), popInfo())} />
                </div>
              </Match>
            </Switch>
          </div>
        </Match>
      </Switch>
    </aside>
  )
}
