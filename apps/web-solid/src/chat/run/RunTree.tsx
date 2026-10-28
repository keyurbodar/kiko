import type { RunStep } from "@kiko/protocol"
import { CheckIcon, ChevronRightIcon, CopyIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
  untrack,
  For,
  type JSX,
} from "solid-js"
import { unwrap } from "solid-js/store"
import { room } from "../../state/room"
import { thoughtMs, thoughtText, type Thought } from "../../state/thoughts"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { findFile } from "../ui/find-file"
import { HelperLanes } from "../helpers/HelperLanes"
import { Mochi } from "../ui/Mochi"
import { ThoughtStream } from "../thinking/Thinking"
import { durationLabel, elapsedLabel, fullTimeLabel } from "./duration"
import { GLYPH } from "./glyphs"
import { type StepIcon } from "./run-log"
import {
  type DetailStatus,
  groupSummary,
  isLive,
  type LabelPart,
  type NoteItem,
  type RowDetail,
  type StepItem,
  summaryOf,
  summaryText,
  type WorkerItem,
  type WorkItem,
  workLogOf,
} from "./run-tree-rows"
import { recallSummary, rememberSummary } from "./run-summary"
import { Shine } from "./Shine"
import { Branch } from "./branch"
import "./run-tree.css"

const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
const [asked, setAsked] = createSignal<ReadonlySet<string>>(new Set())

const MAX_OPENED = 100
const FRESH_MS = 1_200
const LONG_LIST = 10
const SHORT_LIST = 6
const COPIED_MS = 1_200
const LINE_LIMIT = 200
const CROSSFADE_MS = 300
const FIRST_DELAY_MS = 90
const STAGGER_MS = 65

const PILL =
  "cursor-pointer rounded-row bg-fill px-2.5 py-0.5 text-fg transition-transform hover:bg-fill-hover active:scale-[0.97]"

function withKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  next.add(key)
  if (next.size > MAX_OPENED) next.delete(next.values().next().value as string)
  return next
}

function setOpen(key: string, value: boolean) {
  setOpened((current) => {
    const next = new Set(current)
    next.delete(key)
    return value ? withKey(next, key) : next
  })
}

const runKeyOf = (windowKey: string) => `${room.activeId() ?? ""}|${windowKey}`

export const runOpen = (windowKey: string): boolean => opened().has(runKeyOf(windowKey))

export function toggleRun(windowKey: string): void {
  setOpen(runKeyOf(windowKey), !runOpen(windowKey))
}

type Fold = "gone" | "open" | "grow" | "shut"

const foldMs = (element: HTMLElement) =>
  Math.max(
    0,
    ...getComputedStyle(element)
      .transitionDuration.split(",")
      .map((s) => Number.parseFloat(s) * 1000 || 0),
  )

function foldOf(isOpen: boolean, moves: boolean, list: HTMLDivElement | undefined): { fold: Fold; ms: number } {
  if (isOpen) return { fold: moves ? "grow" : "open", ms: 0 }
  const ms = moves && list ? foldMs(list) : 0
  return { fold: ms === 0 ? "gone" : "shut", ms }
}

type View = {
  now: () => number
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  openStep: (step: StepItem) => void
  retry: () => void
}

const fresh = (at: number | undefined, now: number) => at !== undefined && now - at < FRESH_MS

const secondsLabel = (ms: number) => `${Math.max(1, Math.round(ms / 1_000))}s`

const delayOf = (freshRow: boolean, order: number) => (freshRow ? FIRST_DELAY_MS + Math.min(order, 8) * STAGGER_MS : 0)

const retried = (step: StepItem, steps: readonly RunStep[]) => {
  const raw = steps.find((entry) => entry.id === step.id)
  if (!raw) return false
  return steps.some((later) => later.name === raw.name && later.status === "done" && later.startedAt > raw.startedAt)
}

function Label(props: { text: string; parts?: readonly LabelPart[]; running: boolean }) {
  return (
    <Shine running={props.running} class="run-tree-label">
      <Show when={!props.running && props.parts} fallback={props.text}>
        {(parts) => (
          <For each={parts()}>
            {(part) => (
              <Show when={part.strong} fallback={part.text}>
                <span class="run-tree-object" data-mono={part.mono ? "" : undefined}>
                  {part.text}
                </span>
              </Show>
            )}
          </For>
        )}
      </Show>
    </Shine>
  )
}

function Chevron(props: { open: boolean }) {
  return (
    <span class="run-tree-chevron motion-run-chevron" data-open={props.open ? "" : undefined} aria-hidden="true">
      <RemixIcon icon={ChevronRightIcon} size={12} />
    </span>
  )
}

function Retry(props: { onRetry: () => void }) {
  return (
    <button type="button" class={PILL} onClick={() => props.onRetry()}>
      Retry
    </button>
  )
}

function Took(props: { startedAt: number; endedAt?: number; running: boolean; now: number }) {
  const ms = () => (props.running || props.endedAt === undefined ? props.now : props.endedAt) - props.startedAt
  return (
    <Show when={ms() >= 1_000}>
      <span
        class="run-tree-meta run-tree-time"
        data-component="run-tree-time"
        data-live={props.running ? "" : undefined}
        title={fullTimeLabel(props.startedAt)}
      >
        {props.running ? elapsedLabel(ms()) : durationLabel(ms())}
      </span>
    </Show>
  )
}

function Leaves(props: { running: boolean; failed: boolean }) {
  return (
    <span
      class="run-tree-icon run-tree-leaves"
      data-running={props.running ? "" : undefined}
      data-failed={props.failed ? "" : undefined}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

function Icon(props: { icon?: StepIcon; running: boolean; failed: boolean; settled: boolean }) {
  return (
    <span class="run-tree-slot" aria-hidden="true" data-settled={props.settled && !props.running ? "" : undefined}>
      <Show when={!props.running} fallback={<Mochi size={16} />}>
        <RemixIcon
          icon={GLYPH[props.failed ? "alert-circle" : (props.icon ?? "wrench")]}
          size={16}
          class="run-tree-icon"
          data-failed={props.failed ? "" : undefined}
        />
      </Show>
    </span>
  )
}

function CopyText(props: { text: string; label: string }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async () => {
    await navigator.clipboard?.writeText(props.text)
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), COPIED_MS)
  }
  return (
    <button
      type="button"
      class="run-tree-copy"
      data-copied={copied() ? "" : undefined}
      aria-label={copied() ? "Copied" : props.label}
      onClick={() => void copy()}
    >
      <RemixIcon icon={copied() ? CheckIcon : CopyIcon} size={12} />
      <Show when={copied()}>
        <span>Copied</span>
      </Show>
    </button>
  )
}

function DetailEmpty(props: { detail: RowDetail; onRetry: () => void }) {
  const text = () =>
    props.detail.running ? "Running…" : props.detail.status === "ready" ? "No output." : "Loading output…"
  return (
    <Show when={props.detail.status === "error"} fallback={<p class="run-tree-note">{text()}</p>}>
      <p class="run-tree-note">
        Output unavailable <Retry onRetry={props.onRetry} />
      </p>
    </Show>
  )
}

function Detail(props: { detail: RowDetail; onRetry: () => void }) {
  const [all, setAll] = createSignal(false)
  let output: HTMLPreElement | undefined
  const lines = () => (props.detail.output ?? "").split("\n")
  const shown = () => (all() ? props.detail.output : lines().slice(0, LINE_LIMIT).join("\n"))
  createEffect(
    on(
      () => props.detail.output,
      () => {
        if (!props.detail.running || !output) return
        output.scrollTop = output.scrollHeight
      },
    ),
  )
  return (
    <div class="run-tree-detail">
      <Show
        when={props.detail.input || props.detail.output}
        fallback={<DetailEmpty detail={props.detail} onRetry={props.onRetry} />}
      >
        <div class="run-tree-block">
          <Show when={props.detail.input}>
            {(input) => (
              <div class="run-tree-input">
                <pre class="run-tree-mono">{input()}</pre>
                <CopyText text={input()} label="Copy input" />
              </div>
            )}
          </Show>
          <Show when={props.detail.output}>
            {(text) => (
              <div class="run-tree-output-wrap">
                <pre ref={output} class="run-tree-mono run-tree-output">
                  {shown()}
                </pre>
                <CopyText text={text()} label="Copy output" />
                <Show when={lines().length > LINE_LIMIT && !all()}>
                  <button type="button" class="run-tree-more-lines" onClick={() => setAll(true)}>
                    Show all {lines().length} lines
                  </button>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function StepRow(props: {
  step: StepItem
  view: View
  depth: number
  order: number
  steps: readonly RunStep[]
  liveTrunk: boolean
  liveBranch: boolean
  continues: boolean
}) {
  const open = () => props.view.isOpen(props.step.id)
  const opensFile = () => !!props.step.target && !props.step.target.folder
  const born = () => fresh(props.step.startedAt, props.view.now())
  const settled = () => fresh(props.step.endedAt, props.view.now())
  const failed = () => props.step.failed && !retried(props.step, props.steps)
  return (
    <div
      class="run-tree-item"
      data-kind="step"
      data-depth={props.depth}
      data-fresh={born() ? "" : undefined}
      style={{ "--run-delay": `${delayOf(born(), props.order)}ms` }}
    >
      <button
        type="button"
        class="run-tree-row"
        data-kind="step"
        data-running={props.step.running ? "" : undefined}
        data-settled={settled() && !props.step.running ? "" : undefined}
        data-failed={failed() ? "" : undefined}
        data-file={props.step.target ? "" : undefined}
        aria-expanded={props.step.target ? undefined : open()}
        data-disclosure=""
        title={opensFile() ? `Open ${props.step.target!.path}` : undefined}
        onClick={() => props.view.openStep(props.step)}
      >
        <Branch
          depth={props.depth}
          liveTrunk={props.liveTrunk}
          liveBranch={props.liveBranch}
          failed={failed()}
          fresh={born()}
          continues={props.continues}
        />
        <Icon icon={props.step.icon} running={props.step.running} failed={failed()} settled={settled()} />
        <Label text={props.step.label} parts={props.step.parts} running={props.step.running} />
        <Show when={!props.step.target}>
          <Chevron open={open()} />
        </Show>
        <Took
          startedAt={props.step.startedAt}
          endedAt={props.step.endedAt}
          running={props.step.running}
          now={props.view.now()}
        />
      </button>
      <Show when={open()}>
        <Detail detail={props.step.detail} onRetry={props.view.retry} />
      </Show>
    </div>
  )
}

function runningChild(worker: WorkerItem): StepItem | undefined {
  return worker.steps.find((step) => step.running)
}

function WorkerRow(props: {
  worker: WorkerItem
  view: View
  depth: number
  order: number
  steps: readonly RunStep[]
  liveTrunk: boolean
  liveBranch: boolean
  liveChild?: string
  liveChildIndex: number
  continues: boolean
}) {
  const open = () => props.worker.running || props.view.isOpen(props.worker.id)
  const born = () => fresh(props.worker.startedAt, props.view.now())
  const state = () => (props.worker.running ? (runningChild(props.worker)?.label ?? "Working") : props.worker.meta)
  return (
    <div
      class="run-tree-item"
      data-kind="worker"
      data-depth={props.depth}
      data-fresh={born() ? "" : undefined}
      style={{ "--run-delay": `${delayOf(born(), props.order)}ms` }}
    >
      <button
        type="button"
        class="run-tree-row"
        data-kind="worker"
        data-running={props.worker.running ? "" : undefined}
        data-failed={props.worker.failed ? "" : undefined}
        aria-expanded={open()}
        data-disclosure=""
        onClick={() => props.view.toggle(props.worker.id)}
      >
        <Branch
          depth={props.depth}
          liveTrunk={props.liveTrunk}
          liveBranch={props.liveBranch}
          failed={props.worker.failed}
          fresh={born()}
          continues={props.continues}
        />
        <span class="run-tree-slot">
          <Leaves running={props.worker.running} failed={props.worker.failed} />
        </span>
        <Label text={props.worker.label} running={props.worker.running} />
        <Show when={state()} keyed>
          {(text) => (
            <Show when={props.worker.running} fallback={<span class="run-tree-meta">{text}</span>}>
              <Shine running class="run-tree-meta">
                {text}
              </Shine>
            </Show>
          )}
        </Show>
        <Chevron open={open()} />
      </button>
      <Show when={open()}>
        <div class="run-tree-children">
          <Index each={props.worker.steps}>
            {(step, index) => (
              <StepRow
                step={step()}
                view={props.view}
                depth={props.depth + 1}
                order={index}
                steps={props.steps}
                liveTrunk={props.liveChild !== undefined && index <= props.liveChildIndex}
                liveBranch={props.liveChild === step().id}
                continues={index < props.worker.steps.length - 1}
              />
            )}
          </Index>
        </div>
      </Show>
    </div>
  )
}

function NoteRow(props: {
  note: NoteItem
  view: View
  depth: number
  order: number
  liveTrunk: boolean
  continues: boolean
}) {
  const born = () => fresh(props.note.startedAt, props.view.now())
  return (
    <div
      class="run-tree-item"
      data-kind="note"
      data-depth={props.depth}
      data-fresh={born() ? "" : undefined}
      style={{ "--run-delay": `${delayOf(born(), props.order)}ms` }}
    >
      <div class="run-tree-row run-tree-said">
        <Branch
          depth={props.depth}
          liveTrunk={props.liveTrunk}
          liveBranch={false}
          failed={false}
          fresh={born()}
          continues={props.continues}
        />
        <span class="run-tree-slot">
          <RemixIcon icon={GLYPH.bulb} size={16} class="run-tree-icon" />
        </span>
        <p class="run-tree-label">{props.note.text}</p>
      </div>
    </div>
  )
}

function ThoughtRow(props: {
  thought: Thought
  depth: number
  order: number
  now: number
  live: boolean
  continues: boolean
}) {
  const [open, setOpen] = createSignal(false)
  const ms = () => thoughtMs(props.thought, props.now)
  const text = () => thoughtText(props.thought)
  const born = () => props.live
  return (
    <Show when={text()}>
      <div
        class="run-tree-item"
        data-kind="thought"
        data-depth={props.depth}
        data-fresh={born() ? "" : undefined}
        style={{ "--run-delay": `${delayOf(born(), props.order)}ms` }}
      >
        <button
          type="button"
          class="run-tree-row"
          data-kind="thought"
          aria-expanded={open()}
          data-disclosure=""
          onClick={() => setOpen(!open())}
        >
          <Branch
            depth={props.depth}
            liveTrunk={props.live}
            liveBranch={props.live}
            failed={false}
            fresh={born()}
            continues={props.continues}
          />
          <span class="run-tree-slot">
            <RemixIcon icon={GLYPH.bulb} size={16} class="run-tree-icon" />
          </span>
          <span class="run-tree-label">Thought for {secondsLabel(ms())}</span>
          <Chevron open={open()} />
        </button>
        <Show when={open()}>
          <ThoughtStream text={text()} live={props.live} follow={props.live} class="run-tree-thought" />
        </Show>
      </div>
    </Show>
  )
}

function Items(props: {
  items: readonly WorkItem[]
  view: View
  steps: readonly RunStep[]
  live: boolean
  liveTop: string | undefined
  liveTopIndex: number
  liveChild: string | undefined
  liveChildIndex: number
  thought: Thought | undefined
  whole: boolean
  onWhole: () => void
}) {
  const long = () => !props.whole && props.items.length > LONG_LIST
  const shown = () => (long() ? props.items.slice(0, SHORT_LIST) : props.items)
  return (
    <>
      <Show when={props.thought}>
        {(thought) => (
          <ThoughtRow
            thought={thought()}
            depth={0}
            order={0}
            now={props.view.now()}
            live={props.live}
            continues={props.items.length > 0}
          />
        )}
      </Show>
      <Index each={shown()}>
        {(item, index) => (
          <Switch>
            <Match when={item().kind === "step" && (item() as StepItem)}>
              {(step) => (
                <StepRow
                  step={step()}
                  view={props.view}
                  depth={0}
                  order={index}
                  steps={props.steps}
                  liveTrunk={props.live && props.liveTopIndex >= 0 && index <= props.liveTopIndex}
                  liveBranch={props.live && props.liveTop === step().id}
                  continues={index < shown().length - 1}
                />
              )}
            </Match>
            <Match when={item().kind === "note" && (item() as NoteItem)}>
              {(note) => (
                <NoteRow
                  note={note()}
                  view={props.view}
                  depth={0}
                  order={index}
                  liveTrunk={props.live && props.liveTopIndex >= 0 && index <= props.liveTopIndex}
                  continues={index < shown().length - 1}
                />
              )}
            </Match>
            <Match when={item().kind === "worker" && (item() as WorkerItem)}>
              {(worker) => (
                <WorkerRow
                  worker={worker()}
                  view={props.view}
                  depth={0}
                  order={index}
                  steps={props.steps}
                  liveTrunk={props.live && props.liveTopIndex >= 0 && index <= props.liveTopIndex}
                  liveBranch={props.live && props.liveTop === worker().id}
                  liveChild={props.liveTop === worker().id ? props.liveChild : undefined}
                  liveChildIndex={props.liveChildIndex}
                  continues={index < shown().length - 1}
                />
              )}
            </Match>
          </Switch>
        )}
      </Index>
      <Show when={long()}>
        <button type="button" class="run-tree-row run-tree-more" onClick={() => props.onWhole()}>
          <Branch depth={0} liveTrunk={false} liveBranch={false} failed={false} fresh={false} />
          <span class="run-tree-slot" />
          <span class="run-tree-label">+{props.items.length - SHORT_LIST} steps</span>
        </button>
      </Show>
    </>
  )
}

function Missing(props: { missing: "loading" | "error"; onRetry: () => void }) {
  return (
    <div class="run-tree-row" data-kind={props.missing}>
      <Branch depth={0} liveTrunk={false} liveBranch={false} failed={false} fresh={false} />
      <span class="run-tree-slot" />
      <Show
        when={props.missing === "error"}
        fallback={
          <Shine running class="run-tree-label">
            Loading steps…
          </Shine>
        }
      >
        <span class="run-tree-label">Steps unavailable</span>
        <Retry onRetry={props.onRetry} />
      </Show>
    </div>
  )
}

function Head(props: {
  live: boolean
  settling: boolean
  label: string
  summary: string
  worked: string
  clock: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <Show
      when={props.live}
      fallback={
        <Show
          when={props.settling}
          fallback={
            <button
              type="button"
              class="run-tree-head"
              aria-expanded={props.open}
              data-disclosure=""
              onClick={props.onToggle}
            >
              <span class="run-tree-summary">{props.worked}</span>
              <Chevron open={props.open} />
            </button>
          }
        >
          <div class="run-tree-head" data-settling="" aria-hidden="true">
            <span class="run-tree-crossfade">
              <span class="run-tree-cross-out">{props.summary}</span>
              <span class="run-tree-cross-in">{props.worked}</span>
            </span>
          </div>
        </Show>
      }
    >
      <div class="run-tree-head" data-live="" data-component="run-tree-head-live">
        <Shine running class="run-tree-summary">
          {props.label}
        </Shine>
        <Show when={props.clock} keyed>
          {(text) => (
            <span class="run-tree-clock" aria-hidden="true">
              <span class="run-tree-clock-text">{text}</span>
            </span>
          )}
        </Show>
      </div>
    </Show>
  )
}

export function RunTree(props: {
  windowKey: string
  count?: number
  endedAt?: number
  who?: string
  at?: number
  thought?: Thought
}): JSX.Element {
  const steps = createMemo(() => unwrap(room.runSteps(props.windowKey)) as readonly RunStep[])
  const working = () => room.runLive(props.windowKey)
  const live = createMemo(() => isLive(steps(), working()))
  const openKey = () => runKeyOf(props.windowKey)
  const itemKey = (id: string) => `${openKey()}|${id}`
  const open = createMemo(() => opened().has(openKey()))

  const detailStatus = createMemo<DetailStatus>(() => {
    if (steps().length >= (props.count ?? 0)) return "ready"
    if (room.runFetching(props.windowKey)) return "loading"
    return asked().has(openKey()) ? "error" : "idle"
  })

  const request = (force = false) => {
    const key = openKey()
    setAsked((current) => (current.has(key) ? current : withKey(current, key)))
    room.loadRunSteps(props.windowKey, force)
  }

  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!live()) return
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(clock))
  })

  const lanes = createMemo(() => room.helpers().filter((lane) => lane.window === props.windowKey))

  const log = createMemo(() =>
    workLogOf(steps(), {
      lanes: lanes().length > 0,
      working: working(),
      count: props.count,
      endedAt: props.endedAt,
      detail: detailStatus(),
      known: recallSummary(openKey()),
    }),
  )

  const summary = createMemo(() => {
    const loaded = steps().length >= (props.count ?? 0)
    const text = loaded ? summaryText(groupSummary(steps())) : ""
    return text || log().head?.summary || ""
  })

  const worked = createMemo(() => {
    const head = log().head
    const start = head?.startedAt
    const end = head?.endedAt ?? props.endedAt
    if (start === undefined || end === undefined || end < start) return "Worked"
    return `Worked for ${durationLabel(end - start)}`
  })

  const startedAt = createMemo(() => {
    const head = log().head
    if (head?.startedAt !== undefined) return head.startedAt
    if (steps().length === 0) return undefined
    return Math.min(...steps().map((step) => step.startedAt))
  })

  const clock = createMemo(() => {
    const start = startedAt()
    return start === undefined ? "" : elapsedLabel(now() - start)
  })

  const path = createMemo<{ top?: string; child?: string }>(() => {
    if (!live()) return {}
    for (const item of log().items) {
      if (item.kind === "step" && item.running) return { top: item.id }
      if (item.kind === "worker" && item.running) {
        const child = runningChild(item)
        return { top: item.id, ...(child ? { child: child.id } : {}) }
      }
    }
    return {}
  })

  const liveTopIndex = createMemo(() => {
    const top = path().top
    return top === undefined ? -1 : log().items.findIndex((item) => item.id === top)
  })

  const liveChildIndex = createMemo(() => {
    const top = path().top
    const child = path().child
    if (top === undefined || child === undefined) return -1
    const worker = log().items.find((item) => item.id === top)
    return worker?.kind === "worker" ? worker.steps.findIndex((step) => step.id === child) : -1
  })

  const liveText = createMemo(() => {
    const top = path().top
    const item = log().items.find((entry) => entry.id === top)
    if (!item) return "Working"
    if (item.kind === "note") return item.text
    if (item.kind === "step") return item.label
    const child = runningChild(item)
    return child ? `${item.label}: ${child.label}` : item.label
  })

  const [settling, setSettling] = createSignal(false)
  const [crossFrom, setCrossFrom] = createSignal("")
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(settleTimer))
  createEffect(
    on(
      live,
      (isLive, wasLive) => {
        if (isLive || !wasLive) return
        setCrossFrom(untrack(summary) || untrack(liveText))
        setSettling(true)
        setOpen(openKey(), false)
        clearTimeout(settleTimer)
        settleTimer = setTimeout(() => setSettling(false), CROSSFADE_MS)
      },
      { defer: true },
    ),
  )

  const expanded = createMemo(() => live() || settling() || open())
  const [fold, setFold] = createSignal<Fold>(untrack(expanded) ? "open" : "gone")
  let clicked = false
  let list: HTMLDivElement | undefined
  createEffect(
    on(
      expanded,
      (isOpen) => {
        const moves = clicked || untrack(fold) !== "gone"
        clicked = false
        const next = foldOf(isOpen, moves, list)
        setFold(next.fold)
        if (next.fold !== "shut") return
        const timer = setTimeout(() => setFold("gone"), next.ms)
        onCleanup(() => clearTimeout(timer))
      },
      { defer: true },
    ),
  )

  const toggleHead = () => {
    clicked = true
    setOpen(openKey(), !open())
  }

  createEffect(() => {
    if (live() || steps().length < (props.count ?? 0)) return
    const found = summaryOf(steps(), props.endedAt)
    if (found) rememberSummary(openKey(), found)
  })

  createEffect(() => {
    if (!live() && steps().length < (props.count ?? 0)) untrack(() => request())
  })

  const [whole, setWhole] = createSignal(false)
  const [shownSteps, setShownSteps] = createSignal<ReadonlySet<string>>(new Set())
  const view: View = {
    now,
    isOpen: (id) => (id.startsWith("w:") ? opened().has(itemKey(id)) : shownSteps().has(id)),
    toggle: (id) => setOpen(itemKey(id), !opened().has(itemKey(id))),
    openStep: (step) => {
      const chat = room.activeId()
      const target = step.target
      if (chat && target) {
        const found = target.folder ? null : findFile(target.path)
        if (found?.kind === "file") return openFile(chat, found.path)
        if (target.folder || found?.kind === "many") return openSurface(chat, fixedSurface("files"))
      }
      setShownSteps((current) => {
        const next = new Set(current)
        if (!next.delete(step.id)) next.add(step.id)
        return next
      })
      request()
    },
    retry: () => request(true),
  }

  const body = () => (
    <div class="run-tree-list">
      <Items
        items={log().items}
        view={view}
        steps={steps()}
        live={live()}
        liveTop={path().top}
        liveTopIndex={liveTopIndex()}
        liveChild={path().child}
        liveChildIndex={liveChildIndex()}
        thought={props.thought}
        whole={whole() || live()}
        onWhole={() => setWhole(true)}
      />
      <Show when={log().missing}>{(missing) => <Missing missing={missing()} onRetry={view.retry} />}</Show>
    </div>
  )

  return (
    <div class="run-tree" data-component="run-tree" data-live={live() ? "" : undefined}>
      <Head
        live={live()}
        settling={settling()}
        label={liveText()}
        summary={crossFrom()}
        worked={worked()}
        clock={clock()}
        open={open()}
        onToggle={toggleHead}
      />
      <Show when={live() || settling() || fold() !== "gone"}>
        <div
          ref={list}
          class="run-tree-fold motion-run-fold"
          data-grow={fold() === "grow" ? "" : undefined}
          data-shut={!live() && !settling() && fold() === "shut" ? "" : undefined}
        >
          <div>{body()}</div>
        </div>
      </Show>
      <HelperLanes lanes={lanes()} now={now()} />
    </div>
  )
}
