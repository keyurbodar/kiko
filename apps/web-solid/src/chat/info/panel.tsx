import { createEffect, createMemo, For, lazy, Match, on, onCleanup, Show, Suspense, Switch } from "solid-js"
import { openTasks, TasksView } from "./tasks"
import { CollapsibleV2 } from "@kiko/ui/v2/collapsible-v2"
import { useCommands } from "../../commands/registry"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { openBirdPicker } from "../../mascot/picker-state"
import { useApp } from "../../lib/store"
import { chatModel } from "../../settings/chat-model"
import { MemoryError, MemoryList, useMemoryStore } from "./memory/views"
import { SoulCard } from "./soul"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { BackIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { Card, DangerRow, DeleteChat, EDGE, Header, NavRow, NavRows, Profile, Properties, Property, roomMembers } from "./sections"
import { MemberList } from "../members/members"
import { shortDate, startedAt } from "./format"
import { loadLoops, PlatePage, loopsOf, refreshLoops } from "./loops"
import { loadRoutines, RoutinesPage, routinesOf } from "./routines"
import {
  closeInfo,
  type InfoView,
  infoDepth,
  infoOpen,
  infoSections,
  infoView,
  openFilePath,
  openSections,
  popInfo,
  pushInfo,
  resetInfo,
  SECTION_IDS,
  type SectionId,
  sectionFocus,
  setSectionOpen,
  showSection,
} from "./state"

const count = (n: number) => (n ? String(n) : "")

// The files section is its own chunk: the tree and the viewers load when it first opens.
const loadFiles = () => import("../../files/pane")
const FilesPane = lazy(loadFiles)
const FilesActions = lazy(() => loadFiles().then((m) => ({ default: m.FilesActions })))
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
 * The context section: who and when, memory, plate, routines, and delete. Each thing has one way
 * in. The model is the chip in the top bar, and pin, mute and private are the chat's menu in the list.
 */
function ContextBody(props: { chatId: string }) {
  const members = roomMembers
  const memory = useMemoryStore()
  const memoryCount = () => count(memory()?.state.lines.filter((l) => !l.redacted).length ?? 0)
  const extras = createMemo(() => infoSections().filter((s) => !s.when || s.when(props.chatId)))
  const lead = () => members().find((m) => m.lead) ?? members()[0]
  const started = () => startedAt(props.chatId)
  // Routines are fetched each time the front page shows, so a new one an agent made appears.
  void loadRoutines()
  return (
    <div class="flex flex-col" data-component="info-home">
      <Header chatId={props.chatId} />
      <Properties>
        <Property label="Model" field="model">{(chatModel(props.chatId) ?? lead()?.model)?.split("/").slice(1).join("/") ?? "None"}</Property>
        <Show when={lead()}>
          {(m) => <Property label="Status" field="status">{sentence(useApp.room()?.state.status[m().slug as never] ?? "idle")}</Property>}
        </Show>
        <Show when={started()}>{(at) => <Property label="Started" field="started">{shortDate(at())}</Property>}</Show>
      </Properties>
      <NavRows>
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
      </NavRows>
      <For each={extras()}>
        {(section) => (
          <Card id={section.id} title={section.title}>
            {section.render(props.chatId)}
          </Card>
        )}
      </For>
      <Show when={!useApp.user()?.chats().find((c) => c.roomId === props.chatId)?.kiko}>
        <DeleteChat chatId={props.chatId} />
      </Show>
    </div>
  )
}

function AgentsBody() {
  return (
    <div class="px-2 pb-2" data-component="info-agents">
      <MemberList members={roomMembers()} onOpen={(slug) => pushInfo({ kind: "agent", slug })} />
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


const iconButton = "grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-[var(--hover-bg)] hover:text-text"

const SECTION_TITLES: Record<SectionId, string> = { context: "Context", agents: "Agents", tasks: "Tasks", files: "Files" }
const SECTION_KEYS: Record<SectionId, string> = { context: "C", agents: "A", tasks: "T", files: "F" }
const KEY_SECTIONS: Record<string, SectionId> = { c: "context", a: "agents", t: "tasks", f: "files" }

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]'

/** A letter hint fires only outside text fields and with nothing floating above the panel. */
function hintTarget(event: KeyboardEvent): SectionId | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return null
  const id = KEY_SECTIONS[event.key.toLowerCase()]
  if (!id || !infoOpen()) return null
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest(TYPING) || document.activeElement?.closest(TYPING)) return null
  if (document.querySelector(OVERLAYS)) return null
  return id
}

function SectionBody(props: { id: SectionId; chatId: string }) {
  return (
    <Switch>
      <Match when={props.id === "context"}>
        <ContextBody chatId={props.chatId} />
      </Match>
      <Match when={props.id === "agents"}>
        <AgentsBody />
      </Match>
      <Match when={props.id === "tasks"}>
        <div class="px-2.5 pb-3">
          <TasksView />
        </div>
      </Match>
      <Match when={props.id === "files"}>
        <Suspense>
          <FilesPane chatId={props.chatId} />
        </Suspense>
      </Match>
    </Switch>
  )
}

function Section(props: { id: SectionId; chatId: string }) {
  const open = () => openSections().has(props.id)
  const total = () => {
    if (props.id === "agents") return roomMembers().length + 1
    if (props.id === "tasks") return openTasks(useApp.room()?.tasks() ?? []).length
    return 0
  }
  return (
    <CollapsibleV2
      open={open()}
      onOpenChange={(value) => setSectionOpen(props.id, value)}
      class="info-section flex shrink-0 flex-col"
      classList={{ "min-h-80 flex-1": props.id === "files" && open() }}
      data-component="info-section"
      data-section={props.id}
    >
      <div class={`flex h-9 shrink-0 items-center border-b ${EDGE} pr-2`}>
        <CollapsibleV2.Trigger
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-2 pl-2.5 text-left text-[12px] font-medium text-muted outline-none hover:text-text focus-visible:text-text"
          data-section-trigger={props.id}
          aria-keyshortcuts={SECTION_KEYS[props.id]}
        >
          <span class="grid size-4 shrink-0 place-items-center" classList={{ "rotate-90": open() }} aria-hidden="true">
            <HugeIcon icon={ChevronRightIcon} size={14} />
          </span>
          <span class="truncate">{SECTION_TITLES[props.id]}</span>
          <Show when={total() > 0}>
            <span class="tabular-nums text-faint">{total()}</span>
          </Show>
        </CollapsibleV2.Trigger>
        <Show when={props.id === "files" && open() && !openFilePath(props.chatId)}>
          <Suspense>
            <FilesActions />
          </Suspense>
        </Show>
        <kbd class="ml-1 grid h-4 min-w-4 place-items-center rounded-[4px] border border-[var(--panel-edge)] px-1 text-[10px] leading-none text-faint" aria-hidden="true">
          {SECTION_KEYS[props.id]}
        </kbd>
      </div>
      <CollapsibleV2.Content class={props.id === "files" ? "flex min-h-0 flex-1 flex-col" : undefined}>
        <SectionBody id={props.id} chatId={props.chatId} />
      </CollapsibleV2.Content>
    </CollapsibleV2>
  )
}

/*
 * The chat's right panel: stacked collapsible sections (context, agents, tasks, files) in one scroll,
 * after t3code's right panel launcher. Letter keys open them. The header is the top bar's height,
 * so the panel and the transcript line up. The panel is a fill, not a border. Nothing here animates.
 */
export default function InfoPanel(props: { chatId: string }) {
  // Escape closes the panel. It is a command like every shortcut, and a dialog or menu above the
  // panel (the image dialog, a picker, a crumb's folder menu) keeps its own Escape. Whether one was
  // open is read before anyone handles the key, because it closes itself on the same keydown,
  // before this command runs.
  let dialogOnKey = false
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dialogOnKey = !!document.querySelector(OVERLAYS)
  }
  const onHint = (e: KeyboardEvent) => {
    const id = hintTarget(e)
    if (!id) return
    e.preventDefault()
    showSection(id)
  }
  window.addEventListener("keydown", onKey, true)
  window.addEventListener("keydown", onHint)
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("keydown", onHint)
  })
  useCommands([
    {
      id: "chat.info-close",
      title: "Close panel",
      group: "chat",
      icon: "close",
      shortcut: "Escape",
      passive: true,
      run: () => {
        if (dialogOnKey || document.querySelector(OVERLAYS)) return
        closeInfo()
      },
    },
  ])
  let scroller: HTMLDivElement | undefined
  const key = () => `${props.chatId}:${infoView().kind}`

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
  createEffect(
    on(sectionFocus, (request) => {
      if (!request) return
      queueMicrotask(() => {
        const trigger = scroller?.querySelector<HTMLElement>(`[data-section-trigger="${request.id}"]`)
        trigger?.focus()
        trigger?.scrollIntoView({ block: "nearest" })
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
  return (
    <aside class="info-pane relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden" data-component="info-panel" aria-label="Chat panel">
      <Show
        when={infoDepth() > 1}
        fallback={
          <header class={`flex h-[50px] shrink-0 items-center border-b ${EDGE} px-3`}>
            <h2 class="min-w-0 flex-1 truncate text-sm font-medium text-text" data-component="info-title">Details</h2>
          </header>
        }
      >
        <header class={`flex h-[50px] shrink-0 items-center gap-1 border-b ${EDGE} pr-2 pl-2`}>
          <button type="button" class={iconButton} data-action="back" aria-label="Back" onClick={() => popInfo()}>
            <Back />
          </button>
          <h2 class="min-w-0 flex-1 truncate text-[13px] font-medium text-text" data-component="info-title">
            {titleOf(view())}
          </h2>
        </header>
      </Show>
      <div
        ref={scroller}
        class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none"
        data-component="info-scroll"
        onScroll={(event) => scrolls.set(key(), event.currentTarget.scrollTop)}
      >
        <Switch>
          <Match when={view().kind === "home"}>
            <For each={SECTION_IDS}>{(id) => <Section id={id} chatId={props.chatId} />}</For>
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
        </Switch>
      </div>
    </aside>
  )
}
