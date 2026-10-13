import { createEffect, createMemo, createUniqueId, For, lazy, Match, on, onCleanup, Show, Suspense, Switch } from "solid-js"
import { openTasks, TasksView } from "./tasks"
import { useCommands } from "../../commands/registry"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { openBirdPicker } from "../../mascot/picker-state"
import { useApp } from "../../lib/store"
import { chatModel } from "../../settings/chat-model"
import { MemoryError, MemoryList, useMemoryStore } from "./memory/views"
import { SoulCard } from "./soul"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { BackIcon } from "@kiko/ui/icons"
import { Card, DangerRow, DeleteChat, EDGE, Header, Members, NavRow, NavRows, Profile, Properties, Property, roomMembers, tabKeys } from "./sections"
import { shortDate, startedAt } from "./format"
import { loadLoops, PlatePage, loopsOf, refreshLoops } from "./loops"
import { loadRoutines, RoutinesPage, routinesOf } from "./routines"
import {
  closeFile,
  closeInfo,
  FILE_MIN_WIDTH,
  fileMaxWidth,
  fileTabsOf,
  type InfoTab,
  type InfoView,
  infoDepth,
  infoOpen,
  infoSections,
  infoTab,
  infoView,
  MAX_WIDTH,
  MIN_WIDTH,
  openFilePath,
  panelWidth,
  popInfo,
  pushInfo,
  reopenClosedFile,
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
const TAB_LABELS: Record<InfoTab, string> = { info: "Details", files: "Files" }
/** "idle" reads "Idle": the status is a wire value, its label is interface. */
const sentence = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/*
 * The chat info panel: everything about one chat behind one click on its name. It is the
 * right-hand column of the shell, 340 px by default as monocode's and resizable by its left edge. The
 * shell loads this file on the first open, so the chat route does not carry it.
 *
 * Each card opens its full list inside the panel, and the back arrow returns. Nothing here
 * animates. The panel stays mounted across chats, and the scroll position of each chat's view
 * is kept, so coming back to a chat finds its panel where it was left.
 */

const scrolls = new Map<string, number>()

const TITLES: Record<InfoView["kind"], string> = {
  home: "Details",
  memory: "Memory",
  agent: "Agent",
  soul: "Soul",
  routines: "Routines",
  plate: "On your plate",
  tasks: "Tasks",
}

/** A page's title: an agent's page and its soul carry the agent's name. */
function titleOf(view: InfoView): string {
  if (view.kind === "agent") return roomMembers().find((m) => m.slug === view.slug)?.name ?? view.slug
  if (view.kind === "soul") return `${roomMembers().find((m) => m.slug === view.slug)?.name ?? view.slug}'s soul`
  return TITLES[view.kind]
}

/** One agent, as monocode shows a Mono: its face and name, its facts, its soul, and remove at the bottom. */
function AgentPage(props: { slug: string; chatId: string }) {
  const member = () => roomMembers().find((m) => m.slug === props.slug)
  const status = () => useApp.room()?.state.status[props.slug as never] ?? "idle"
  return (
    <div class="flex min-h-full flex-col" data-component="info-agent" data-slug={props.slug}>
      <Profile
        face={
          <button
            type="button"
            class="rounded-full outline-none"
            aria-label="Change bird"
            title="Change bird"
            data-action="change-bird"
            onClick={() => openBirdPicker(props.slug)}
          >
            <IdentityAvatar seed={props.slug} size={56} state={status() === "working" ? "working" : status() === "typing" ? "typing" : undefined} />
          </button>
        }
      >
        <h2 class="text-[15px] font-semibold text-text">{member()?.name ?? props.slug}</h2>
      </Profile>
      <Properties>
        <Property label="Role" field="role">{member()?.lead ? "Lead" : "Agent"}</Property>
        <Property label="Model" field="model">{(chatModel(props.chatId) ?? member()?.model)?.split("/").slice(1).join("/") ?? "None"}</Property>
        <Property label="Status" field="status">{sentence(status())}</Property>
      </Properties>
      <NavRows>
        <NavRow id="soul" label="Soul" description="Who it is and how it works with you. It keeps this current itself." onClick={() => pushInfo({ kind: "soul", slug: props.slug })} />
      </NavRows>
      <Show when={member() && roomMembers().length > 1}>
        <DangerRow
          action="remove-agent"
          label="Remove from chat"
          description="It leaves this chat. Its soul and memory stay."
          onClick={() => {
            useApp.memberOp({ op: "remove", slug: props.slug as never })
            popInfo()
          }}
        />
      </Show>
    </div>
  )
}

/*
 * The panel's home: who and when, the members, memory, and delete.
 * Each thing has one way in. The model is the chip in the top bar, files are the files tab,
 * and pin, mute and private are the chat's menu in the list.
 */
function Home(props: { chatId: string }) {
  const members = roomMembers
  const memory = useMemoryStore()
  const memoryCount = () => count(memory()?.state.lines.filter((l) => !l.redacted).length ?? 0)
  const extras = createMemo(() => infoSections().filter((s) => !s.when || s.when(props.chatId)))
  const lead = () => members().find((m) => m.lead) ?? members()[0]
  const started = () => startedAt(props.chatId)
  // Routines are fetched each time the front page shows, so a new one an agent made appears.
  void loadRoutines()
  return (
    <div class="flex min-h-full flex-col" data-component="info-home">
      <Header chatId={props.chatId} />
      <Properties>
        <Property label="Model" field="model">{(chatModel(props.chatId) ?? lead()?.model)?.split("/").slice(1).join("/") ?? "None"}</Property>
        <Show when={lead()}>
          {(m) => <Property label="Status" field="status">{sentence(useApp.room()?.state.status[m().slug as never] ?? "idle")}</Property>}
        </Show>
        <Show when={started()}>{(at) => <Property label="Started" field="started">{shortDate(at())}</Property>}</Show>
      </Properties>
      <Members members={members()} />
      <NavRows>
        {/* The agent's soul, one click from the front page as monocode puts a Mono's. A group's
            other agents keep theirs on their own pages. */}
        <Show when={lead()}>
          {(m) => (
            <NavRow
              id="soul"
              label={members().length > 1 ? `${m().name}'s soul` : "Soul"}
              description="Who it is and how it works with you. It keeps this current itself."
              onClick={() => pushInfo({ kind: "soul", slug: m().slug })}
            />
          )}
        </Show>
        <NavRow id="memory" label="Memory" description="Facts and preferences your agents remember." count={memoryCount()} onClick={() => pushInfo({ kind: "memory" })} />
        <NavRow
          id="plate"
          label="On your plate"
          description="Goals, plans and deadlines you mentioned here, and what your agents promised."
          count={count(loopsOf(props.chatId)?.length ?? 0)}
          onClick={() => pushInfo({ kind: "plate" })}
        />
        <NavRow
          id="routines"
          label="Routines"
          description="What your agents do on their own, on a schedule or when something happens."
          count={count(routinesOf(props.chatId)?.filter((r) => r.status === "active").length ?? 0)}
          onClick={() => pushInfo({ kind: "routines" })}
        />
        <Show when={members().length > 1}>
          <NavRow id="tasks" label="Tasks" description="Work the lead split up for the team." count={count(openTasks(useApp.room()?.tasks() ?? []).length)} onClick={() => pushInfo({ kind: "tasks" })} />
        </Show>
      </NavRows>
      <For each={extras()}>
        {(section) => (
          <Card id={section.id} title={section.title}>
            {section.render(props.chatId)}
          </Card>
        )}
      </For>
      {/* The kiko chat is always there, so it has no delete. */}
      <Show when={!useApp.user()?.chats().find((c) => c.roomId === props.chatId)?.kiko}>
        <DeleteChat chatId={props.chatId} />
      </Show>
    </div>
  )
}

function MemoryViews() {
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

function Back() {
  return <HugeIcon icon={BackIcon} size={16} />
}


/**
 * Drag the left edge. Open files have their own, wider width, as t3code's preview panel does, so
 * closing the last restores the narrow one. The line shows on hover and while dragging, like the
 * sidebar's.
 */
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
      aria-label="Resize panel"
      aria-valuemin={wide() ? FILE_MIN_WIDTH : MIN_WIDTH}
      aria-valuemax={wide() ? fileMaxWidth() : MAX_WIDTH}
      aria-valuenow={panelWidth(props.chatId)}
      data-component="info-resizer"
      class="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-0 after:w-0.5 after:bg-[color-mix(in_oklab,var(--text)_14%,transparent)] after:opacity-0 after:content-[''] hover:after:opacity-100 active:after:opacity-100"
      onPointerDown={(event) => {
        start = { x: event.clientX, width: panelWidth(props.chatId), wide: wide() }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", stop)
        event.preventDefault()
      }}
    />
  )
}

const iconButton = "grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--hover-bg)] hover:text-text"

/*
 * The chat's right panel: two tabs, info and files, after t3code's right panel. The tab row is
 * the top bar's height, so the panel and the transcript line up. The panel is a fill, not a
 * border: kat separates with fill or shadow. Nothing here animates.
 */
export default function InfoPanel(props: { chatId: string }) {
  // Escape closes the panel; its file tabs stay for next time. It is a
  // command like every shortcut, and a dialog or menu above the panel (the image dialog, a picker,
  // a crumb's folder menu) keeps its own Escape. Whether one was open is read before anyone handles
  // the key, because it closes itself on the same keydown, before this command runs.
  const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"]'
  let dialogOnKey = false
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dialogOnKey = !!document.querySelector(DIALOG)
  }
  window.addEventListener("keydown", onKey, true)
  onCleanup(() => window.removeEventListener("keydown", onKey, true))
  useCommands([
    {
      id: "chat.info-close",
      title: "Close panel",
      group: "chat",
      icon: "close",
      shortcut: "Escape",
      passive: true,
      run: () => {
        if (dialogOnKey || document.querySelector(DIALOG)) return
        closeInfo()
      },
    },
    {
      id: "files.close-tab",
      title: "Close file tab",
      group: "chat",
      icon: "close",
      shortcut: "Alt+W",
      when: () => infoOpen() && infoTab() === "files" && openFilePath(props.chatId) !== null,
      run: () => closeFile(props.chatId),
    },
    {
      id: "files.reopen-tab",
      title: "Reopen closed file tab",
      group: "chat",
      icon: "undo",
      shortcut: "Alt+Shift+T",
      when: () => infoOpen() && infoTab() === "files" && fileTabsOf(props.chatId).closed.length > 0,
      run: () => void reopenClosedFile(props.chatId),
    },
  ])
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
  // The plate is fetched when the panel opens and when its page shows, and again, debounced, when the
  // room gets a message or a run ends. The cached list paints first.
  createEffect(on(() => [props.chatId, view().kind === "plate"], () => void loadLoops()))
  createEffect(
    on(
      () => [useApp.room()?.state.seq, useApp.room()?.state.status],
      () => refreshLoops(),
      { defer: true },
    ),
  )
  const ids = createUniqueId()
  // Beside the chat the panel leaves the chat at least 360 px, as t3code's preview does. Below 760 px it covers the chat instead.
  return (
    <aside
      class="info-pane relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--panel-edge)] @min-[761px]/main:max-w-[calc(100%-360px)] @max-[760px]/main:absolute @max-[760px]/main:inset-y-0 @max-[760px]/main:right-0 @max-[760px]/main:z-30 @max-[760px]/main:bg-[var(--sidebar-solid)] @max-[760px]/main:shadow-[var(--popover-shadow)]"
      style={{ width: `min(${panelWidth(props.chatId)}px, 100%)` }}
      data-component="info-panel"
      data-tab={infoTab()}
      aria-label="Chat panel"
    >
      <Resizer chatId={props.chatId} />
      {/* Monocode's sidebar header: 40px over a hairline. A page inside info replaces it with a back
          button and the page's title, as a Mono's pages do; the tabs come back with the front page. */}
      <Show
        when={infoTab() === "info" && infoDepth() > 1}
        fallback={
          <header class={`flex h-10 shrink-0 items-center gap-0.5 border-b ${EDGE} pr-2 pl-2`}>
            <div
              class="flex min-w-0 items-center"
              role="tablist"
              aria-label="Panel"
              data-component="info-tabs"
              onKeyDown={(event) => tabKeys(event, TABS, infoTab(), setInfoTab)}
            >
              <For each={TABS}>
                {(tab) => (
                  <button
                    type="button"
                    role="tab"
                    id={`${ids}-tab-${tab}`}
                    class="h-7 rounded-md px-2 text-md font-medium text-[color-mix(in_oklab,var(--text)_45%,transparent)] hover:text-text aria-selected:text-text"
                    aria-selected={infoTab() === tab}
                    aria-controls={`${ids}-panel-${tab}`}
                    tabIndex={infoTab() === tab ? 0 : -1}
                    data-tab={tab}
                    onClick={() => setInfoTab(tab)}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                )}
              </For>
            </div>
            <span class="flex-1" aria-hidden="true" />
            <Show when={infoTab() === "files"}>
              <Suspense>
                <FilesActions />
              </Suspense>
            </Show>
          </header>
        }
      >
        <header class={`flex h-10 shrink-0 items-center gap-1 border-b ${EDGE} pr-2 pl-2`}>
          <button type="button" class={iconButton} data-action="back" aria-label="Back" onClick={() => popInfo()}>
            <Back />
          </button>
          <h2 class="min-w-0 flex-1 truncate text-[13px] font-medium text-text" data-component="info-title">
            {titleOf(view())}
          </h2>
        </header>
      </Show>
      <Switch>
        <Match when={infoTab() === "files"}>
          <div
            class="flex min-h-0 flex-1 flex-col"
            role="tabpanel"
            id={`${ids}-panel-files`}
            aria-labelledby={`${ids}-tab-files`}
            data-component="info-files-tab"
          >
            <Suspense>
              <FilesPane chatId={props.chatId} />
            </Suspense>
          </div>
        </Match>
        <Match when={infoTab() === "info"}>
          <div
            ref={scroller}
            class="min-h-0 flex-1 overflow-y-auto overscroll-none"
            role="tabpanel"
            id={`${ids}-panel-info`}
            aria-labelledby={`${ids}-tab-info`}
            data-component="info-scroll"
            onScroll={(event) => scrolls.set(key(), event.currentTarget.scrollTop)}
          >
            <Switch>
              <Match when={view().kind === "home"}>
                <Home chatId={props.chatId} />
              </Match>
              <Match when={view().kind === "memory"}>
                <MemoryViews />
              </Match>
              <Match when={view().kind === "agent"}>
                <AgentPage slug={(view() as { slug: string }).slug} chatId={props.chatId} />
              </Match>
              <Match when={view().kind === "routines"}>
                <RoutinesPage chatId={props.chatId} />
              </Match>
              <Match when={view().kind === "plate"}>
                <PlatePage chatId={props.chatId} />
              </Match>
              <Match when={view().kind === "soul"}>
                <SoulCard slug={(view() as { slug: string }).slug} />
              </Match>
              <Match when={view().kind === "tasks"}>
                <div class="px-2.5 py-3">
                  <TasksView />
                </div>
              </Match>
            </Switch>
          </div>
        </Match>
      </Switch>
    </aside>
  )
}
