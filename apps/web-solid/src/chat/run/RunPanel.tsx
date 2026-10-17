import type { RunStep } from "@kiko/protocol"
import { type Glyph, HugeIcon } from "@kiko/ui/huge-icon"
import * as glyphs from "@kiko/ui/icons"
import { PopoverV2 } from "@kiko/ui/v2/popover-v2-impl"
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js"
import { unwrap } from "solid-js/store"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { cn } from "../../lib/cn"
import { useApp } from "../../lib/store"
import { logoUrl } from "../../recipes/icon"
import {
  anyRunning,
  buildEntries,
  type Entry,
  extraInput,
  formatClock,
  formatDuration,
  iconOf,
  keepEntries,
  liveLabel,
  startOf,
  type StepIcon,
  summarizeSteps,
  totalDuration,
} from "./run-log"
import { closeRun, openRun, runAnchor } from "./run-panel-state"
import "./run-panel.css"

/*
 * The run panel: every tool call of one run, in a floating card. Rows are t3code's work log rows
 * (an icon, a label, a small chevron), each closed until clicked. The list is virtualized, so a run
 * of hundreds of steps costs what fits on screen, and its card never grows past its maximum size.
 * It opens only from a chevron, and it follows whichever chevron of its run is on screen.
 */

const GLYPH: Record<StepIcon, Glyph> = {
  "file-view": glyphs.FileViewIcon,
  folder: glyphs.FolderIcon,
  "file-add": glyphs.FileAddIcon,
  edit: glyphs.EditIcon,
  copy: glyphs.CopyIcon,
  trash: glyphs.TrashIcon,
  "folder-add": glyphs.FolderAddIcon,
  move: glyphs.MoveIcon,
  terminal: glyphs.TerminalIcon,
  link: glyphs.LinkIcon,
  globe: glyphs.GlobeIcon,
  search: glyphs.SearchIcon,
  cursor: glyphs.CursorIcon,
  eye: glyphs.EyeIcon,
  code: glyphs.CodeIcon,
  "file-text": glyphs.FileTextIcon,
  browser: glyphs.BrowserIcon,
  monitor: glyphs.MonitorIcon,
  chat: glyphs.ChatIcon,
  help: glyphs.HelpIcon,
  memory: glyphs.MemoryIcon,
  notes: glyphs.NotesIcon,
  book: glyphs.BookIcon,
  clock: glyphs.ClockIcon,
  tasks: glyphs.TasksIcon,
  group: glyphs.GroupIcon,
  integrations: glyphs.IntegrationsIcon,
  sparkles: glyphs.SparklesIcon,
  scan: glyphs.ScanIcon,
  worker: glyphs.WorkerIcon,
  stop: glyphs.StopIcon,
  send: glyphs.SendIcon,
  skills: glyphs.SkillsIcon,
  wrench: glyphs.WrenchIcon,
  "alert-circle": glyphs.AlertCircleIcon,
  app: glyphs.IntegrationsIcon,
}

/** The height a closed row has, which the list assumes for rows it has not measured. */
const ROW_HEIGHT = 32

/** A Composio toolkit's logo, as the recipe cards draw it, with a plug when the picture does not load. */
function AppMark(props: { slug: string }) {
  const [broken, setBroken] = createSignal(false)
  return (
    <Show when={!broken()} fallback={<HugeIcon icon={GLYPH["integrations"]} size={16} />}>
      <span class="run-logo">
        <img src={logoUrl({ slug: props.slug })} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      </span>
    </Show>
  )
}

function StepGlyph(props: { step: RunStep }) {
  const icon = () => iconOf(props.step)
  return (
    <span class="run-icon" data-failed={props.step.status === "failed" ? "" : undefined}>
      <Show when={icon() === "app" && props.step.app} fallback={<HugeIcon icon={GLYPH[icon()]} size={16} />}>
        {(slug) => <AppMark slug={slug()} />}
      </Show>
    </span>
  )
}

/** Whole seconds since `from`, ticking once a second while `live`. */
function createElapsed(from: () => number | undefined, live: () => boolean) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!live()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return () => formatClock(now() - (from() ?? now()))
}

function RowChevron(props: { open: boolean }) {
  return (
    <span class="run-chevron" data-open={props.open ? "" : undefined} aria-hidden="true">
      <HugeIcon icon={glyphs.ChevronRightIcon} size={12} />
    </span>
  )
}

function Output(props: { step: RunStep; loading: boolean }) {
  return (
    <Show
      when={props.step.output}
      fallback={
        <p class="run-note">
          {props.step.status === "running" ? "Running…" : props.loading ? "Loading output…" : "No output."}
        </p>
      }
    >
      {(text) => <pre class="run-mono run-out" data-failed={props.step.status === "failed" ? "" : undefined}>{text()}</pre>}
    </Show>
  )
}

function StepRow(props: { step: RunStep; child: boolean; open: boolean; loading: boolean; onToggle: () => void }) {
  const step = () => props.step
  const running = () => step().status === "running"
  const took = () => (step().endedAt === undefined ? undefined : step().endedAt! - step().startedAt)
  return (
    <div class="run-row" data-child={props.child ? "" : undefined} data-status={step().status} data-component="run-step">
      <div
        class="run-line"
        role="button"
        tabindex="0"
        aria-expanded={props.open}
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <StepGlyph step={step()} />
        <span class={cn("run-label", running() && "motion-shine")} data-failed={step().status === "failed" ? "" : undefined}>
          {liveLabel(step())}
        </span>
        <Show when={took() !== undefined && took()! >= 1000}>
          <span class="run-took">{formatDuration(took()!)}</span>
        </Show>
        <RowChevron open={props.open} />
      </div>
      <Show when={props.open}>
        <div class="run-detail">
          <Show when={extraInput(step())}>{(input) => <pre class="run-mono run-input">{input()}</pre>}</Show>
          <Output step={step()} loading={props.loading} />
        </div>
      </Show>
    </div>
  )
}

function WorkerRow(props: { entry: Extract<Entry, { kind: "worker" }>; onToggle: () => void }) {
  const steps = () => props.entry.steps
  const live = () => anyRunning(steps())
  const elapsed = createElapsed(() => startOf(steps()), live)
  const sum = () => summarizeSteps(steps()).summary
  const took = () => totalDuration(steps())
  return (
    <div class="run-row" data-component="run-worker" data-open={props.entry.open ? "" : undefined}>
      <div
        class="run-line run-line-worker"
        role="button"
        tabindex="0"
        aria-expanded={props.entry.open}
        onClick={props.onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          props.onToggle()
        }}
      >
        <span class="run-icon">
          <HugeIcon icon={GLYPH["worker"]} size={16} />
        </span>
        <span class="run-worker-text">
          <span class="run-label run-worker-task">{props.entry.task}</span>
          <span class={cn("run-worker-state", live() && "motion-shine")}>{live() ? `Working for ${elapsed()}` : `${sum()}${took() === undefined ? "" : `, ${formatDuration(took()!)}`}`}</span>
        </span>
        <RowChevron open={props.entry.open} />
      </div>
    </div>
  )
}

function Header(props: { steps: readonly RunStep[]; live: boolean }) {
  const elapsed = createElapsed(() => startOf(props.steps), () => props.live)
  const sum = createMemo(() => summarizeSteps(props.steps))
  const took = () => totalDuration(props.steps)
  return (
    <div class="run-header">
      <PopoverV2.Title class="run-title" data-live={props.live ? "" : undefined}>
        <Show when={props.live} fallback={props.steps.length ? sum().summary : "No steps yet"}>
          <span class="motion-shine">Working for {elapsed()}</span>
        </Show>
      </PopoverV2.Title>
      <Show when={!props.live && took() !== undefined}>
        <span class="run-total">{formatDuration(took()!)}</span>
      </Show>
      <Show when={!props.live && sum().hasFailure}>
        <span class="run-icon" data-failed="" title="A step failed">
          <HugeIcon icon={GLYPH["alert-circle"]} size={14} />
        </span>
      </Show>
      <PopoverV2.CloseButton class="run-close" aria-label="Close steps" onClick={() => queueMicrotask(() => runAnchorFocus())}>
        <HugeIcon icon={glyphs.CloseIcon} size={14} />
      </PopoverV2.CloseButton>
    </div>
  )
}

let focusRun: string | undefined
const runAnchorFocus = () => {
  if (focusRun) runAnchor(focusRun)?.focus({ preventScroll: true })
}

const AT_END = 4

function Body(props: { runId: string }) {
  focusRun = props.runId
  const steps = createMemo(() => unwrap(useApp.runSteps(props.runId)) as readonly RunStep[])
  const live = createMemo(() => useApp.runLive(props.runId) || anyRunning(steps()))
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [workers, setWorkers] = createSignal<ReadonlySet<string>>(new Set())
  const toggle = (set: typeof setExpanded, id: string) =>
    set((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  let previous = new Map<string, Entry>()
  const entries = createMemo(() => {
    const next = keepEntries(previous, buildEntries(steps(), workers()))
    previous = new Map(next.map((entry) => [entry.key, entry]))
    return next
  })

  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const [handle, setHandle] = createSignal<VirtualizerHandle>()
  const [fade, setFade] = createSignal({ top: false, bottom: false })
  let stick = untrack(live)

  const measure = () => {
    const list = handle()
    if (!list) return
    const top = list.scrollOffset > 1
    const bottom = list.scrollOffset + list.viewportSize < list.scrollSize - 1
    setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }))
  }
  const follow = () => {
    const list = handle()
    const last = entries().length - 1
    if (!list || !stick || last < 0) return
    list.scrollToIndex(last, { align: "end" })
  }

  // The list's height changes as rows measure, open, and arrive: keep the fades and the end in step.
  createEffect(() => {
    const element = scroller()
    const inner = element?.firstElementChild
    if (!element || !inner) return
    const observer = new ResizeObserver(() => {
      measure()
      follow()
    })
    observer.observe(element)
    observer.observe(inner)
    onCleanup(() => observer.disconnect())
  })
  // A live step lands or finishes: stay at the end only when the reader is there.
  createEffect(
    on(entries, () => requestAnimationFrame(() => (follow(), measure())), { defer: true }),
  )

  const onScroll = () => {
    const list = handle()
    if (list) stick = list.scrollOffset + list.viewportSize >= list.scrollSize - AT_END
    measure()
  }

  return (
    <>
      <Header steps={steps()} live={live()} />
      <div
        ref={setScroller}
        class="run-scroll"
        data-top={fade().top ? "" : undefined}
        data-bottom={fade().bottom ? "" : undefined}
        data-component="run-list"
      >
        <Show when={scroller()}>
          {(element) => (
            <Virtualizer data={entries()} scrollRef={element()} itemSize={ROW_HEIGHT} bufferSize={240} ref={setHandle} onScroll={onScroll}>
              {(entry) =>
                entry.kind === "worker" ? (
                  <WorkerRow entry={entry} onToggle={() => toggle(setWorkers, entry.id)} />
                ) : (
                  <StepRow
                    step={entry.step}
                    child={entry.child}
                    open={expanded().has(entry.step.id)}
                    loading={useApp.runFetching(props.runId)}
                    onToggle={() => toggle(setExpanded, entry.step.id)}
                  />
                )
              }
            </Virtualizer>
          )}
        </Show>
      </div>
    </>
  )
}

export default function RunPanel() {
  const [shown, setShown] = createSignal<string>()
  createEffect(() => {
    const run = openRun()
    if (run) setShown(run)
  })
  let last: HTMLElement | undefined
  const anchor = () => {
    const run = openRun() ?? shown()
    const found = run ? runAnchor(run) : undefined
    if (found) last = found
    return found ?? last
  }
  const visible = () => {
    const run = openRun()
    return run !== null && runAnchor(run) !== undefined
  }

  // A panel whose chevron is gone for good (its row left the list) closes instead of hanging unseen.
  createEffect(() => {
    const run = openRun()
    if (run === null || runAnchor(run)) return
    const timer = setTimeout(() => openRun() === run && !runAnchor(run) && closeRun(), 400)
    onCleanup(() => clearTimeout(timer))
  })
  createEffect(on(() => useApp.activeThreadId(), closeRun, { defer: true }))

  return (
    <PopoverV2
      open={visible()}
      onOpenChange={(open) => !open && closeRun()}
      anchorRef={anchor}
      placement="right-start"
      flip="bottom-start top-start left-start"
      hideWhenDetached
    >
      <PopoverV2.Portal>
        <PopoverV2.Content
          class="run-panel"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => queueMicrotask(runAnchorFocus)}
          onInteractOutside={(event) => {
            // The chevron toggles the panel itself, so a press on it is not an outside press.
            if ((event.target as Element | null)?.closest?.('[data-component="run-chevron"]')) event.preventDefault()
          }}
        >
          <Show when={shown()} keyed>
            {(run) => <Body runId={run} />}
          </Show>
        </PopoverV2.Content>
      </PopoverV2.Portal>
    </PopoverV2>
  )
}
