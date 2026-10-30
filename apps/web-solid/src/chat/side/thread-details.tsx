import { fileName, type FileRef, type HumanAsk, type RunStep, type Task } from "@kiko/protocol"
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  GlobeIcon,
  MemoryIcon,
  SearchIcon,
  SlidersIcon,
  UploadIcon,
} from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js"
import { fileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { agentDisplayName } from "../../lib/names"
import { requestJump } from "../../search/state"
import { fileSrc, room } from "../../state/room"
import { elapsed, helperWord } from "../helpers/helper-model"
import { Snowflake } from "../helpers/Snowflake"
import { useMemoryStore } from "../info/memory/views"
import { taskOwner, taskText } from "../info/tasks-model"
import { stepWindows } from "../run/run-log"
import { fixedSurface, helperSurface, openFile, openSurface } from "./surfaces"
import { THREAD_DETAILS_ITEMS, type ThreadDetailsItemId } from "./thread-details-items"
import {
  agentFiles,
  ALL_DONE_MS,
  helperSplit,
  knowns,
  nowRows,
  outputTiles,
  progressView,
  usedRows,
  type UsedRow,
} from "./thread-details-model"
import { threadDetailsVisibility } from "./thread-details-state"
import { ThreadDetailsMenuItems } from "./thread-details-menu"
import "./thread-details.css"

const TILE_COLUMNS = 6
const TILE_ROWS = 2
const SLOTS = TILE_COLUMNS * TILE_ROWS
const ICON = "grid size-6 shrink-0 place-items-center rounded-control text-fg3 hover:bg-hover hover:text-fg"

function CustomizeTrigger(props: { row?: boolean }) {
  return (
    <TooltipV2 placement="left" openDelay={300} value="Choose what to show">
      <MenuV2.Trigger
        class={props.row ? "td-row" : ICON}
        aria-label="Choose what to show"
        data-action={props.row ? "customize-details-empty" : "customize-details"}
      >
        <RemixIcon icon={SlidersIcon} size={16} class={props.row ? "shrink-0 text-[var(--text-300)]" : "size-3.5"} />
        <Show when={props.row}>
          <span class="min-w-0 flex-1 truncate">Choose what to show</span>
        </Show>
      </MenuV2.Trigger>
    </TooltipV2>
  )
}

function Count(props: { value: string }) {
  return (
    <Show when={props.value} keyed>
      {(value) => <span class="td-count shrink-0 text-[11px] text-[var(--text-400)]">{value}</span>}
    </Show>
  )
}

function Section(props: {
  id: ThreadDetailsItemId
  title: string
  count?: string
  action?: JSX.Element
  class?: string
  children: JSX.Element
}) {
  const [folded, setFolded] = createSignal(false)
  return (
    <section class={`td-section ${props.class ?? ""}`} data-section={props.id} aria-labelledby={`td-head-${props.id}`}>
      <div class="td-heading">
        <button
          type="button"
          class="-ml-2 flex h-8 min-w-0 flex-1 items-center gap-1 rounded-[6px] px-2 text-left hover:bg-[var(--td-hover)]"
          aria-expanded={!folded()}
          aria-controls={`td-body-${props.id}`}
          data-action={`fold-${props.id}`}
          onClick={() => setFolded(!folded())}
        >
          <RemixIcon
            icon={ChevronRightIcon}
            size={16}
            class="td-chevron size-3.5 shrink-0 text-[var(--text-300)]"
            data-open={!folded() ? "" : undefined}
          />
          <span id={`td-head-${props.id}`} class="min-w-0 truncate text-[11px] font-medium text-[var(--text-300)]">
            {props.title}
          </span>
          <Show when={props.count}>{(count) => <Count value={count()} />}</Show>
        </button>
        {props.action}
      </div>
      <div class="td-fold" data-open={!folded() ? "" : undefined}>
        <div id={`td-body-${props.id}`}>{props.children}</div>
      </div>
    </section>
  )
}

function Row(props: {
  children: JSX.Element
  onClick?: () => void
  label?: string
  action?: string
  class?: string
  style?: string
}) {
  return (
    <button
      type="button"
      class={`td-row ${props.class ?? ""}`}
      style={props.style}
      aria-label={props.label}
      data-action={props.action}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function NowSection(props: { now: number; action?: JSX.Element }) {
  const rows = () =>
    nowRows({
      slugs: room.typingSlugs(),
      lines: room.typingDoings(),
      since: (slug) => {
        const key = room.typingRun(slug)
        const steps = key ? room.runSteps(key) : []
        const first = steps.reduce((min, step) => Math.min(min, step.startedAt), Number.POSITIVE_INFINITY)
        if (Number.isFinite(first)) return first
        return room.messages().findLast((message) => message.sender === "user")?.sentAt
      },
      fallback: props.now,
    })
  return (
    <Section id="now" title="Now" action={props.action}>
      <For each={rows()}>
        {(row, index) => (
          <div
            class="td-row td-row-enter"
            style={`--td-i: ${index()}`}
            data-component="details-now"
            data-slug={row.slug}
          >
            <IdentityAvatar seed={row.slug} size={16} />
            <span class="min-w-0 flex-1 truncate">
              <span class="chat-shimmer">{row.line}</span>
            </span>
            <span class="shrink-0 text-[11px] text-[var(--text-400)]">{elapsed(props.now - row.since)}</span>
            <span class="sr-only">{agentDisplayName(row.slug, room.roomMembers())}</span>
          </div>
        )}
      </For>
    </Section>
  )
}

function WaitingSection(props: { chatId: string; asks: readonly HumanAsk[]; action?: JSX.Element }) {
  const approve = (ask: HumanAsk) => {
    const choice = ask.options?.[0]
    if (choice !== undefined) room.active()?.answer(ask.id, choice)
    else document.querySelector<HTMLElement>(".composer-dock .ProseMirror")?.focus()
  }
  const details = (ask: HumanAsk) => {
    const seq = room.messageById(ask.messageId)?.seq
    if (seq === undefined) return
    requestJump({ roomId: props.chatId as never, id: ask.messageId, seq })
  }
  return (
    <Section id="waiting" title="Waiting on you" action={props.action}>
      <For each={props.asks}>
        {(ask, index) => (
          <div
            class="td-row td-row-enter h-auto min-h-8 py-1"
            style={`--td-i: ${index()}`}
            data-component="details-waiting"
            data-ask={ask.id}
          >
            <span class="min-w-0 flex-1 truncate">{ask.text}</span>
            <button
              type="button"
              class="td-button"
              data-tone="strong"
              data-action="details-approve"
              onClick={() => approve(ask)}
            >
              Approve
            </button>
            <button type="button" class="td-button" data-action="details-show" onClick={() => details(ask)}>
              Details
            </button>
          </div>
        )}
      </For>
    </Section>
  )
}

function TaskCheck(props: { task: Task }) {
  const toggle = () => {
    room.taskOp({ op: "update", id: props.task.id, status: props.task.status === "done" ? "todo" : "done" })
  }
  return (
    <button
      type="button"
      class="grid size-4 shrink-0 place-items-center rounded-[4px] border border-[var(--border-300)] text-[var(--text-400)] hover:border-[var(--text-300)] hover:text-[var(--text-200)]"
      role="checkbox"
      aria-checked={props.task.status === "done"}
      aria-label={props.task.title}
      data-action="toggle-task"
      onClick={toggle}
    >
      <Show when={props.task.status === "done"}>
        <RemixIcon icon={CheckIcon} size={12} />
      </Show>
    </button>
  )
}

function TaskRow(props: { task: Task; current: boolean; index: number }) {
  const owner = () => taskOwner(props.task, room.roomMembers())
  return (
    <div
      class="td-row td-row-enter"
      style={`--td-i: ${props.index}`}
      data-component="details-task"
      data-status={props.task.status}
    >
      <Show when={props.current} fallback={<TaskCheck task={props.task} />}>
        <span class="grid size-4 shrink-0 place-items-center">
          <span class="td-spinner size-3 rounded-full border-[1.5px] border-[var(--border-300)] border-t-[var(--fg)]" />
        </span>
      </Show>
      <span class="min-w-0 flex-1 truncate">{taskText(props.task.title, room.roomMembers())}</span>
      <Show when={props.task.status !== "done" && owner().slug}>
        {(slug) => (
          <span class="flex shrink-0 items-center gap-1 text-[12px] font-normal text-[var(--text-400)]">
            <IdentityAvatar seed={slug()} size={14} />
            <span class="max-w-24 truncate">{owner().name}</span>
          </span>
        )}
      </Show>
    </div>
  )
}

function ProgressSection(props: { tasks: readonly Task[]; running: boolean; action?: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  const [leaving, setLeaving] = createSignal(false)
  const [gone, setGone] = createSignal(false)
  const view = createMemo(() => progressView(props.tasks, props.running))
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  createEffect(() => {
    clear()
    setLeaving(false)
    setGone(false)
    if (!view().allDone || props.running) return
    timer = setTimeout(() => {
      setLeaving(true)
      timer = setTimeout(() => setGone(true), 200)
    }, ALL_DONE_MS)
  })
  onCleanup(clear)
  return (
    <Show when={!gone()}>
      <Section
        id="progress"
        title="Progress"
        count={`${view().completed} of ${view().total}`}
        action={props.action}
        class={leaving() ? "td-leaving" : undefined}
      >
        <Show
          when={!view().allDone}
          fallback={<div class="td-row text-[var(--text-300)]">{`All ${view().total} done`}</div>}
        >
          <For each={view().open}>
            {(task, index) => <TaskRow task={task} current={task.id === view().currentId} index={index()} />}
          </For>
        </Show>
        <Show when={view().done.length > 0}>
          <button
            type="button"
            class="td-row"
            aria-expanded={open()}
            data-action="fold-done-tasks"
            onClick={() => setOpen(!open())}
          >
            <RemixIcon
              icon={ChevronRightIcon}
              size={16}
              class="td-chevron size-3.5 shrink-0 text-[var(--text-400)]"
              data-open={open() ? "" : undefined}
            />
            <span class="min-w-0 flex-1 truncate text-[var(--text-300)]">{`${view().done.length} done`}</span>
          </button>
          <div class="td-fold" data-open={open() ? "" : undefined}>
            <div>
              <For each={view().done}>
                {(task) => (
                  <div class="td-row" data-component="details-task" data-status="done">
                    <span class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1 truncate text-[var(--text-400)] line-through">
                      {taskText(task.title, room.roomMembers())}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Section>
    </Show>
  )
}

function HelpersSection(props: { chatId: string; now: number; action?: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  const split = () => helperSplit(room.helpers(), props.now)
  const group = () => room.roomMembers().length > 1
  const openHelper = (id: string, window: string) => openSurface(props.chatId, helperSurface(id, window))
  return (
    <Section
      id="helpers"
      title="Helpers"
      count={split().working > 0 ? `${split().working} working` : undefined}
      action={props.action}
    >
      <For each={split().shown}>
        {(lane, index) => (
          <Row
            label={lane.title}
            action="open-helper"
            class="td-row-enter"
            style={`--td-i: ${index()}`}
            onClick={() => openHelper(lane.id, lane.window)}
          >
            <Snowflake seed={lane.id} size={14} state={lane.state} parent={group() ? lane.slug : undefined} />
            <span class="min-w-0 shrink truncate">{lane.title}</span>
            <span class="min-w-0 flex-1 truncate font-normal text-[var(--text-400)]">
              {lane.state === "working" ? lane.line : helperWord(lane.state)}
            </span>
            <Show when={lane.state === "working"}>
              <span class="shrink-0 text-[11px] text-[var(--text-400)]">{elapsed(props.now - lane.startedAt)}</span>
            </Show>
            <Show when={lane.state !== "working"}>
              <RemixIcon
                icon={lane.state === "failed" ? AlertCircleIcon : CheckIcon}
                size={16}
                class={`td-check-pop size-3.5 shrink-0 ${
                  lane.state === "failed" ? "text-[var(--danger)]" : "text-[var(--ok)]"
                }`}
              />
            </Show>
          </Row>
        )}
      </For>
      <Show when={split().finished.length > 0}>
        <button
          type="button"
          class="td-row"
          aria-expanded={open()}
          data-action="fold-finished-helpers"
          onClick={() => setOpen(!open())}
        >
          <RemixIcon
            icon={ChevronRightIcon}
            size={16}
            class="td-chevron size-3.5 shrink-0 text-[var(--text-400)]"
            data-open={open() ? "" : undefined}
          />
          <span class="min-w-0 flex-1 truncate text-[var(--text-300)]">{`${split().finished.length} finished`}</span>
        </button>
        <div class="td-fold" data-open={open() ? "" : undefined}>
          <div>
            <For each={split().finished}>
              {(lane) => (
                <Row label={lane.title} action="open-helper" onClick={() => openHelper(lane.id, lane.window)}>
                  <span class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{lane.title}</span>
                  <span
                    class={`shrink-0 text-[12px] font-normal ${
                      lane.state === "failed" ? "text-[var(--danger)]" : "text-[var(--text-400)]"
                    }`}
                  >
                    {helperWord(lane.state)}
                  </span>
                </Row>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Section>
  )
}

const sizeText = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function OutputTile(props: { chatId: string; file: { id: string; name: string; size: number; type: string } }) {
  const name = () => fileName(props.file.name)
  const type = () => fileType({ name: name(), type: props.file.type })
  return (
    <TooltipV2 placement="top" openDelay={300} value={`${name()}, ${sizeText(props.file.size)}`}>
      <button
        type="button"
        class="td-tile"
        aria-label={name()}
        data-action="open-output"
        onClick={() => openFile(props.chatId, props.file.name)}
      >
        <Show when={type() === "image"} fallback={<TypeIcon type={type()} size={20} />}>
          <img class="td-thumb" src={fileSrc(props.chatId, props.file.id)} alt="" loading="lazy" />
        </Show>
      </button>
    </TooltipV2>
  )
}

function OutputsSection(props: { chatId: string; files: readonly FileRef[]; action?: JSX.Element }) {
  const tiles = () => outputTiles(props.files, SLOTS)
  return (
    <Section id="outputs" title="Outputs" count={`${props.files.length}`} action={props.action}>
      <div class="flex flex-wrap gap-1.5 px-2.5 py-1" data-component="details-outputs">
        <For each={tiles().shown}>{(file) => <OutputTile chatId={props.chatId} file={file} />}</For>
        <Show when={tiles().more > 0}>
          <button
            type="button"
            class="td-tile text-[12px] font-medium text-[var(--text-300)]"
            aria-label={`${tiles().more} more files`}
            data-action="open-files"
            onClick={() => openSurface(props.chatId, fixedSurface("files"))}
          >
            {`+${tiles().more}`}
          </button>
        </Show>
      </div>
    </Section>
  )
}

const USED_ICON = { uploads: UploadIcon, web: SearchIcon, pages: GlobeIcon, memory: MemoryIcon } as const

function UsedRowView(props: { row: UsedRow }) {
  const [open, setOpen] = createSignal(false)
  return (
    <HoverCardV2
      open={open()}
      onOpenChange={setOpen}
      openDelay={300}
      closeDelay={120}
      placement="right-start"
      gutter={8}
    >
      <HoverCardV2.Trigger
        class="td-row"
        data-component="details-used"
        data-action={`used-${props.row.kind}`}
        onClick={() => setOpen(!open())}
      >
        <RemixIcon icon={USED_ICON[props.row.kind]} size={16} class="shrink-0 text-[var(--text-300)]" />
        <span class="shrink-0">{props.row.label}</span>
        <span class="min-w-0 flex-1 truncate text-right text-[12px] font-normal text-[var(--text-400)]">
          {props.row.summary}
        </span>
      </HoverCardV2.Trigger>
      <HoverCardV2.Portal>
        <HoverCardV2.Content>
          <div class="flex max-h-80 w-64 flex-col overflow-y-auto p-1" data-component="details-used-pop">
            <For each={props.row.items}>
              {(item) => (
                <div class="flex min-w-0 items-center gap-2.5 rounded-[6px] px-2 py-1.5">
                  <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--text-100)]">{item.name}</span>
                  <span class="shrink-0 text-[11px] text-[var(--text-400)]">{item.meta}</span>
                </div>
              )}
            </For>
          </div>
        </HoverCardV2.Content>
      </HoverCardV2.Portal>
    </HoverCardV2>
  )
}

function UsedSection(props: { steps: readonly RunStep[]; action?: JSX.Element }) {
  const rows = () => usedRows(room.messages(), props.steps)
  return (
    <Section id="used" title="Used in this session" action={props.action}>
      <For each={rows()}>{(row) => <UsedRowView row={row} />}</For>
    </Section>
  )
}

function MemorySection(props: { chatId: string; action?: JSX.Element }) {
  const memory = useMemoryStore()
  const lines = () => (memory()?.state.lines ?? []).filter((line) => !line.redacted)
  return (
    <Section id="memory" title="Kiko knows here" action={props.action}>
      <div class="flex flex-wrap gap-1.5 px-2.5 py-1" data-component="details-memory">
        <For each={knowns(lines()).shown}>
          {(line) => (
            <button type="button" class="td-chip" onClick={() => openSurface(props.chatId, fixedSurface("memory"))}>
              <span class="truncate">{line.text}</span>
            </button>
          )}
        </For>
      </div>
    </Section>
  )
}

function Card(props: { children: JSX.Element }) {
  let scroller: HTMLDivElement | undefined
  const [fade, setFade] = createSignal("")
  const measure = () => {
    if (!scroller) return
    const top = scroller.scrollTop
    const bottom = scroller.scrollHeight - scroller.clientHeight
    setFade([top > 0.5 ? "top" : "", top < bottom - 0.5 ? "bottom" : ""].filter(Boolean).join(" "))
  }
  return (
    <div class="td-card isolate flex min-h-0 flex-col overflow-hidden" data-component="thread-details">
      <div
        class="td-scroll"
        data-fade={fade()}
        onScroll={measure}
        ref={(el) => {
          scroller = el
          queueMicrotask(measure)
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

export default function ThreadDetails(props: { chatId: string }) {
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(tick))
  const [menuOpen, setMenuOpen] = createSignal(false)
  const customize = () => setMenuOpen(true)
  const visibility = () => threadDetailsVisibility()
  const steps = createMemo(() => [...stepWindows(room.messages()).keys()].flatMap((key) => room.runSteps(key)))
  const asks = () => room.active()?.asks() ?? []
  const running = () => room.chatById(props.chatId)?.presence !== "idle"
  const progress = () => progressView(room.tasks(), running())
  const memory = useMemoryStore()
  const memoryLines = () => (memory()?.state.lines ?? []).filter((line) => !line.redacted)
  const outputs = () => agentFiles(room.files())
  const has = (id: ThreadDetailsItemId): boolean => {
    switch (id) {
      case "now":
        return room.typingSlugs().length > 0
      case "waiting":
        return asks().length > 0
      case "progress":
        return progress().total > 0
      case "helpers":
        return room.helpers().length > 0
      case "outputs":
        return outputs().length > 0
      case "used":
        return usedRows(room.messages(), steps()).length > 0
      case "memory":
        return knowns(memoryLines()).shown.length > 0
    }
  }
  const present = () =>
    THREAD_DETAILS_ITEMS.filter((item) => visibility()[item.id] && has(item.id)).map((item) => item.id)
  const action = (id: ThreadDetailsItemId) => (present()[0] === id ? <CustomizeTrigger /> : undefined)
  return (
    <div
      class="flex min-h-0 flex-col"
      data-component="thread-details-frame"
      onContextMenu={(event: MouseEvent) => {
        const target = event.target
        if (target instanceof Element && target.closest("input, textarea, a, [contenteditable='true']")) return
        if ((window.getSelection()?.toString() ?? "") !== "") return
        event.preventDefault()
        customize()
      }}
    >
      <MenuV2 open={menuOpen()} onOpenChange={setMenuOpen}>
        <Card>
          <Show
            when={present().length > 0}
            fallback={
              <div class="p-2">
                <CustomizeTrigger row />
              </div>
            }
          >
            <Show when={visibility().now && has("now")}>
              <NowSection now={now()} action={action("now")} />
            </Show>
            <Show when={visibility().waiting && has("waiting")}>
              <WaitingSection chatId={props.chatId} asks={asks()} action={action("waiting")} />
            </Show>
            <Show when={visibility().progress && has("progress")}>
              <ProgressSection tasks={room.tasks()} running={running()} action={action("progress")} />
            </Show>
            <Show when={visibility().helpers && has("helpers")}>
              <HelpersSection chatId={props.chatId} now={now()} action={action("helpers")} />
            </Show>
            <Show when={visibility().outputs && has("outputs")}>
              <OutputsSection chatId={props.chatId} files={outputs()} action={action("outputs")} />
            </Show>
            <Show when={visibility().used && has("used")}>
              <UsedSection steps={steps()} action={action("used")} />
            </Show>
            <Show when={visibility().memory && has("memory")}>
              <MemorySection chatId={props.chatId} action={action("memory")} />
            </Show>
          </Show>
        </Card>
        <MenuV2.Portal>
          <MenuV2.Content class="min-w-56" data-component="thread-details-menu">
            <ThreadDetailsMenuItems />
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
    </div>
  )
}
