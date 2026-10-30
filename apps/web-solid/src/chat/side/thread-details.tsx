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
import { createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, Show } from "solid-js"
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
  type ProgressView,
  usedRows,
  type UsedRow,
} from "./thread-details-model"
import { threadDetailsVisibility } from "./thread-details-state"
import { ThreadDetailsMenuItems } from "./thread-details-menu"
import "./thread-details.css"

const OUTPUT_ROWS = 5
const CUSTOMIZE_INSET = { top: 12, right: 18, size: 24 }

function CustomizeTrigger() {
  return (
    <TooltipV2 class="td-customize-host" placement="left" openDelay={300} value="Choose what to show">
      <MenuV2.Trigger class="td-customize" aria-label="Choose what to show" data-action="customize-details">
        <RemixIcon icon={SlidersIcon} size={16} class="size-3.5" />
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

function FoldRow(props: { label: string; open: boolean; action: string; onToggle: () => void }) {
  return (
    <button type="button" class="td-row" aria-expanded={props.open} data-action={props.action} onClick={props.onToggle}>
      <RemixIcon
        icon={ChevronRightIcon}
        size={16}
        class="td-chevron size-3.5 shrink-0 text-[var(--text-400)]"
        data-open={props.open ? "" : undefined}
      />
      <span class="min-w-0 flex-1 truncate text-[var(--text-300)]">{props.label}</span>
    </button>
  )
}

function NowSection(props: { now: number }) {
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
    <Section id="now" title="Now">
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

function WaitingSection(props: { chatId: string; asks: readonly HumanAsk[] }) {
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
    <Section id="waiting" title="Waiting on you">
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

function ProgressSection(props: { view: ProgressView; running: boolean; onGone: () => void }) {
  const [open, setOpen] = createSignal(false)
  const [leaving, setLeaving] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  createEffect(() => {
    clear()
    setLeaving(false)
    if (!props.view.allDone || props.running) return
    timer = setTimeout(() => {
      setLeaving(true)
      timer = setTimeout(props.onGone, 200)
    }, ALL_DONE_MS)
  })
  onCleanup(clear)
  return (
    <Section
      id="progress"
      title="Progress"
      count={`${props.view.completed} of ${props.view.total}`}
      class={leaving() ? "td-leaving" : undefined}
    >
      <Show
        when={!props.view.allDone}
        fallback={<div class="td-row text-[var(--text-300)]">{`All ${props.view.total} done`}</div>}
      >
        <For each={props.view.open}>
          {(task, index) => <TaskRow task={task} current={task.id === props.view.currentId} index={index()} />}
        </For>
        <Show when={props.view.done.length > 0}>
          <FoldRow
            label={`${props.view.done.length} done`}
            open={open()}
            action="fold-done-tasks"
            onToggle={() => setOpen(!open())}
          />
          <div class="td-fold" data-open={open() ? "" : undefined}>
            <div>
              <For each={props.view.done}>
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
      </Show>
    </Section>
  )
}

function HelpersSection(props: { chatId: string; now: number }) {
  const [open, setOpen] = createSignal(false)
  const split = () => helperSplit(room.helpers(), props.now)
  const group = () => room.roomMembers().length > 1
  const openHelper = (id: string, window: string) => openSurface(props.chatId, helperSurface(id, window))
  return (
    <Section id="helpers" title="Helpers" count={split().working > 0 ? `${split().working} working` : undefined}>
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
        <FoldRow
          label={`${split().finished.length} finished`}
          open={open()}
          action="fold-finished-helpers"
          onToggle={() => setOpen(!open())}
        />
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

function OutputRow(props: { chatId: string; file: FileRef; index: number }) {
  const name = () => fileName(props.file.name)
  const type = () => fileType({ name: name(), type: props.file.type })
  return (
    <Row
      label={name()}
      action="open-output"
      class="td-row-enter"
      style={`--td-i: ${props.index}`}
      onClick={() => openFile(props.chatId, props.file.name)}
    >
      <span class="td-output-icon">
        <Show when={type() === "image"} fallback={<TypeIcon type={type()} size={16} />}>
          <img class="td-thumb" src={fileSrc(props.chatId, props.file.id)} alt="" loading="lazy" />
        </Show>
      </span>
      <span class="min-w-0 flex-1 truncate">{name()}</span>
      <span class="shrink-0 text-[11px] font-normal text-[var(--text-400)]">{sizeText(props.file.size)}</span>
    </Row>
  )
}

function OutputsSection(props: { chatId: string; files: readonly FileRef[] }) {
  const rows = () => outputTiles(props.files, OUTPUT_ROWS)
  return (
    <Section id="outputs" title="Outputs" count={`${props.files.length}`}>
      <div data-component="details-outputs">
        <For each={rows().shown}>
          {(file, index) => <OutputRow chatId={props.chatId} file={file} index={index()} />}
        </For>
        <Show when={rows().more > 0}>
          <Row
            label={`${rows().more} more files`}
            action="open-files"
            onClick={() => openSurface(props.chatId, fixedSurface("files"))}
          >
            <span class="td-output-icon" />
            <span class="min-w-0 flex-1 truncate text-[var(--text-300)]">{`${rows().more} more`}</span>
          </Row>
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

function UsedSection(props: { steps: readonly RunStep[] }) {
  const rows = () => usedRows(room.messages(), props.steps)
  return (
    <Section id="used" title="Used in this session">
      <For each={rows()}>{(row) => <UsedRowView row={row} />}</For>
    </Section>
  )
}

function MemorySection(props: { chatId: string }) {
  const memory = useMemoryStore()
  const lines = () => (memory()?.state.lines ?? []).filter((line) => !line.redacted)
  return (
    <Section id="memory" title="Kiko knows here">
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

function Card(props: { ref: (el: HTMLDivElement) => void; children: JSX.Element }) {
  let scroller: HTMLDivElement | undefined
  const [fade, setFade] = createSignal("")
  const measure = () => {
    if (!scroller) return
    const top = scroller.scrollTop
    const bottom = scroller.scrollHeight - scroller.clientHeight
    setFade([top > 0.5 ? "top" : "", top < bottom - 0.5 ? "bottom" : ""].filter(Boolean).join(" "))
  }
  return (
    <div class="td-card isolate flex min-h-0 flex-col overflow-hidden" data-component="thread-details" ref={props.ref}>
      <div
        class="td-scroll"
        data-fade={fade()}
        onScroll={measure}
        ref={(el) => {
          scroller = el
          queueMicrotask(measure)
        }}
      >
        <div class="relative">{props.children}</div>
      </div>
    </div>
  )
}

function useProgress(chatId: () => string) {
  const running = () => room.chatById(chatId())?.presence !== "idle"
  const view = createMemo(() => progressView(room.tasks(), running()))
  const [live, setLive] = createSignal(false)
  createEffect(on(chatId, () => setLive(false)))
  createEffect(() => {
    if (view().total > 0 && (!view().allDone || running())) setLive(true)
  })
  return { view, running, live, finish: () => setLive(false) }
}

export default function ThreadDetails(props: { chatId: string }) {
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(tick))
  const [menuOpen, setMenuOpen] = createSignal(false)
  let card: HTMLDivElement | undefined
  const anchor = () => {
    const rect = card?.getBoundingClientRect()
    if (!rect) return undefined
    const { top, right, size } = CUSTOMIZE_INSET
    return { x: rect.right - right - size, y: rect.top + top, width: size, height: size }
  }
  const visibility = () => threadDetailsVisibility()
  const steps = createMemo(() => [...stepWindows(room.messages()).keys()].flatMap((key) => room.runSteps(key)))
  const asks = () => room.active()?.asks() ?? []
  const progress = useProgress(() => props.chatId)
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
        return progress.live()
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
  const shown = (id: ThreadDetailsItemId) => visibility()[id] && has(id)
  const present = () => THREAD_DETAILS_ITEMS.some((item) => shown(item.id))
  return (
    <div
      class="flex min-h-0 flex-col"
      data-component="thread-details-frame"
      onContextMenu={(event: MouseEvent) => {
        const target = event.target
        if (target instanceof Element && target.closest("input, textarea, a, [contenteditable='true']")) return
        if ((window.getSelection()?.toString() ?? "") !== "") return
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <MenuV2 open={menuOpen()} onOpenChange={setMenuOpen} getAnchorRect={anchor} placement="bottom-end" gutter={4}>
        <Card ref={(el) => (card = el)}>
          <Show
            when={present()}
            fallback={
              <div class="p-2">
                <button
                  type="button"
                  class="td-row"
                  data-action="customize-details-empty"
                  onClick={() => setMenuOpen(true)}
                >
                  <RemixIcon icon={SlidersIcon} size={16} class="shrink-0 text-[var(--text-300)]" />
                  <span class="min-w-0 flex-1 truncate">Choose what to show</span>
                </button>
              </div>
            }
          >
            <CustomizeTrigger />
            <Show when={shown("now")}>
              <NowSection now={now()} />
            </Show>
            <Show when={shown("waiting")}>
              <WaitingSection chatId={props.chatId} asks={asks()} />
            </Show>
            <Show when={shown("progress")}>
              <ProgressSection view={progress.view()} running={progress.running()} onGone={progress.finish} />
            </Show>
            <Show when={shown("helpers")}>
              <HelpersSection chatId={props.chatId} now={now()} />
            </Show>
            <Show when={shown("outputs")}>
              <OutputsSection chatId={props.chatId} files={outputs()} />
            </Show>
            <Show when={shown("used")}>
              <UsedSection steps={steps()} />
            </Show>
            <Show when={shown("memory")}>
              <MemorySection chatId={props.chatId} />
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
