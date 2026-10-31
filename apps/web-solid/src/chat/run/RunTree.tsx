import type { RunStep } from "@kiko/protocol"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
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
import { filledParts, partMs, type Thought, type ThoughtPart } from "../../state/thoughts"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { findFile } from "../ui/find-file"
import { Mochi } from "../ui/Mochi"
import { ThoughtStream } from "../thinking/Thinking"
import { durationLabel, elapsedLabel, fullTimeLabel } from "./duration"
import { GLYPH } from "./glyphs"
import { dividerParts } from "../lib/time-label"
import { type StepIcon } from "./run-log"
import {
  type DetailStatus,
  groupSummary,
  LONG_LIST,
  mergeThoughtRows,
  SHORT_LIST,
  isLive,
  type LabelPart,
  type MergedRow,
  type NoteItem,
  type RowDetail,
  type StepItem,
  summaryOf,
  summaryText,
  type WorkerItem,
  type WorkItem,
  workLogOf,
  retried,
} from "./run-tree-rows"
import { recallSummary, rememberSummary } from "./run-summary"
import { Shine } from "./Shine"
import "./run-tree.css"

const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
const [asked, setAsked] = createSignal<ReadonlySet<string>>(new Set())

const MAX_OPENED = 100
const FRESH_MS = 1_200
const COPIED_MS = 1_200
const LINE_LIMIT = 200
const CROSSFADE_MS = 300
const FIRST_DELAY_MS = 0
const STAGGER_MS = 30

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
  seen: () => boolean
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  openStep: (step: StepItem) => void
  retry: () => void
}

const fresh = (at: number | undefined, now: number) => at !== undefined && now - at < FRESH_MS

const secondsLabel = (ms: number) => `${Math.max(1, Math.round(ms / 1_000))}s`

const delayOf = (freshRow: boolean, order: number) => (freshRow ? FIRST_DELAY_MS + Math.min(order, 4) * STAGGER_MS : 0)

const retriedIn = (step: StepItem, steps: readonly RunStep[]) => {
  const raw = steps.find((entry) => entry.id === step.id)
  return raw ? retried(raw, steps) : false
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
      <Time
        at={props.startedAt}
        now={props.now}
        live={props.running}
        text={props.running ? elapsedLabel(ms()) : durationLabel(ms())}
      />
    </Show>
  )
}

function Time(props: { at: number; now: number; text: string; live?: boolean }) {
  return (
    <TooltipV2 class="run-tree-time-slot" placement="top" openDelay={0} value={fullTimeLabel(props.at)}>
      <span class="run-tree-meta run-tree-time" data-component="run-tree-time" data-live={props.live ? "" : undefined}>
        {props.text}
      </span>
    </TooltipV2>
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
      <CopyCheckIcon copied={copied()} size={12} />
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
  order: number
  steps: readonly RunStep[]
  live: boolean
  hot: boolean
}) {
  const open = () => props.view.isOpen(props.step.id)
  const opensFile = () => !!props.step.target && !props.step.target.folder
  const born = () => !props.view.seen() && fresh(props.step.startedAt, props.view.now())
  const settled = () => fresh(props.step.endedAt, props.view.now())
  const failed = () => props.step.failed && !retriedIn(props.step, props.steps)
  return (
    <div
      class="run-tree-item"
      data-kind="step"
      data-fresh={born() ? "" : undefined}
      data-live={props.live ? "" : undefined}
      data-hot={props.hot ? "" : undefined}
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
  order: number
  steps: readonly RunStep[]
  live: boolean
  hot: boolean
  liveChild?: string
  liveChildIndex: number
}) {
  const open = () => props.worker.running || props.view.isOpen(props.worker.id)
  const born = () => !props.view.seen() && fresh(props.worker.startedAt, props.view.now())
  const text = () => {
    const child = runningChild(props.worker)
    return child ? `${props.worker.label}: ${child.label}` : props.worker.label
  }
  return (
    <div
      class="run-tree-item"
      data-kind="worker"
      data-fresh={born() ? "" : undefined}
      data-live={props.live ? "" : undefined}
      data-hot={props.hot ? "" : undefined}
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
        <span class="run-tree-slot">
          <Leaves running={props.worker.running} failed={props.worker.failed} />
        </span>
        <Label text={text()} running={props.worker.running} />
        <Chevron open={open()} />
        <Show
          when={props.worker.running}
          fallback={<Show when={props.worker.meta}>{(meta) => <span class="run-tree-meta">{meta()}</span>}</Show>}
        >
          <Took startedAt={props.worker.startedAt} endedAt={props.worker.endedAt} running now={props.view.now()} />
        </Show>
      </button>
      <Show when={open()}>
        <div class="run-tree-children">
          <Index each={props.worker.steps}>
            {(step, index) => (
              <StepRow
                step={step()}
                view={props.view}
                order={index}
                steps={props.steps}
                live={props.liveChild !== undefined && index <= props.liveChildIndex}
                hot={props.liveChild === step().id}
              />
            )}
          </Index>
        </div>
      </Show>
    </div>
  )
}

function NoteRow(props: { note: NoteItem; view: View; order: number; live: boolean }) {
  const born = () => !props.view.seen() && fresh(props.note.startedAt, props.view.now())
  const [open, setOpen] = createSignal(false)
  return (
    <div
      class="run-tree-item"
      data-kind="note"
      data-fresh={born() ? "" : undefined}
      data-live={props.live ? "" : undefined}
      style={{ "--run-delay": `${delayOf(born(), props.order)}ms` }}
    >
      <button
        type="button"
        class="run-tree-row run-tree-said"
        data-kind="note"
        aria-expanded={open()}
        data-disclosure=""
        onClick={() => setOpen(!open())}
      >
        <span class="run-tree-slot">
          <RemixIcon icon={GLYPH.bulb} size={16} class="run-tree-icon" />
        </span>
        <span class="run-tree-label">{props.note.text}</span>
        <Chevron open={open()} />
      </button>
      <Show when={open()}>
        <p class="run-tree-said-body">{props.note.text}</p>
      </Show>
    </div>
  )
}

function ThoughtRow(props: { part: ThoughtPart; order: number; now: number; live: boolean; open: boolean }) {
  const [opened, setOpened] = createSignal(false)
  const isOpen = () => (props.live && props.open) || opened()
  const ms = () => partMs(props.part, props.now, !props.live)
  const born = () => props.live && fresh(props.part.startedAt, props.now)
  return (
    <div
      class="run-tree-item"
      data-kind="thought"
      data-fresh={born() ? "" : undefined}
      data-live={props.live ? "" : undefined}
      data-hot={props.live && props.open ? "" : undefined}
      style={{ "--run-delay": `${delayOf(born(), props.order)}ms` }}
    >
      <button
        type="button"
        class="run-tree-row"
        data-kind="thought"
        aria-expanded={isOpen()}
        data-disclosure=""
        onClick={() => setOpened(!opened())}
      >
        <span class="run-tree-slot">
          <RemixIcon icon={GLYPH.bulb} size={16} class="run-tree-icon" />
        </span>
        <span class="run-tree-label">Thought for {secondsLabel(ms())}</span>
        <Chevron open={isOpen()} />
      </button>
      <Show when={isOpen()}>
        <ThoughtStream
          text={props.part.text}
          live={props.live && props.open}
          follow={props.live && props.open}
          class="run-tree-thought"
        />
      </Show>
    </div>
  )
}

function Items(props: {
  items: readonly WorkItem[]
  parts: readonly ThoughtPart[]
  view: View
  steps: readonly RunStep[]
  live: boolean
  liveTop: string | undefined
  liveChild: string | undefined
  liveChildIndex: number
  whole: boolean
  onWhole: () => void
}) {
  const rows = createMemo(() => mergeThoughtRows(props.items, props.parts, props.whole))
  const long = () => !props.whole && props.items.length > LONG_LIST
  const newestPart = createMemo(() => props.parts.length - 1)
  const liveUpTo = createMemo(() => {
    const top = rows().findIndex((row) => row.kind === "item" && row.item.id === props.liveTop)
    if (top >= 0) return top
    const newest = newestPart()
    if (newest < 0) return -1
    return rows().findIndex((row) => row.kind === "thought" && row.partIndex === newest)
  })
  const liveRow = (row: MergedRow) => props.live && liveUpTo() >= 0 && row.index <= liveUpTo()
  const thoughtAt = (row: MergedRow) => (row.kind === "thought" ? row.part : undefined)
  const itemAt = (row: MergedRow) => (row.kind === "item" ? row.item : undefined)
  const partIndexOf = (row: MergedRow) => (row.kind === "thought" ? row.partIndex : -1)
  return (
    <>
      <Index each={rows()}>
        {(row) => (
          <Switch>
            <Match when={thoughtAt(row())}>
              {(part) => (
                <ThoughtRow
                  part={part()}
                  order={row().index}
                  now={props.view.now()}
                  live={liveRow(row())}
                  open={partIndexOf(row()) === newestPart()}
                />
              )}
            </Match>
            <Match when={itemAt(row())}>
              {(item) => (
                <Switch>
                  <Match when={item().kind === "step" && (item() as StepItem)}>
                    {(step) => (
                      <StepRow
                        step={step()}
                        view={props.view}
                        order={row().index}
                        steps={props.steps}
                        live={liveRow(row())}
                        hot={props.live && props.liveTop === step().id}
                      />
                    )}
                  </Match>
                  <Match when={item().kind === "note" && (item() as NoteItem)}>
                    {(note) => <NoteRow note={note()} view={props.view} order={row().index} live={liveRow(row())} />}
                  </Match>
                  <Match when={item().kind === "worker" && (item() as WorkerItem)}>
                    {(worker) => (
                      <WorkerRow
                        worker={worker()}
                        view={props.view}
                        order={row().index}
                        steps={props.steps}
                        live={liveRow(row())}
                        hot={props.live && props.liveTop === worker().id}
                        liveChild={props.liveTop === worker().id ? props.liveChild : undefined}
                        liveChildIndex={props.liveChildIndex}
                      />
                    )}
                  </Match>
                </Switch>
              )}
            </Match>
          </Switch>
        )}
      </Index>
      <Show when={long()}>
        <div class="run-tree-item">
          <button type="button" class="run-tree-row run-tree-more" onClick={() => props.onWhole()}>
            <span class="run-tree-slot" />
            <span class="run-tree-label">+{props.items.length - SHORT_LIST} steps</span>
          </button>
        </div>
      </Show>
    </>
  )
}

function Missing(props: { missing: "loading" | "error"; onRetry: () => void }) {
  return (
    <div class="run-tree-item">
      <div class="run-tree-row" data-kind={props.missing}>
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
  startedAt: number | undefined
  now: number
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
              <Show when={props.startedAt}>
                {(at) => <Time at={at()} now={props.now} text={dividerParts(at(), props.now).time} />}
              </Show>
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
            <TooltipV2
              class="run-tree-clock-slot"
              placement="top"
              openDelay={0}
              value={props.startedAt === undefined ? "" : fullTimeLabel(props.startedAt)}
            >
              <span class="run-tree-clock" aria-hidden="true">
                <span class="run-tree-clock-text">{text}</span>
              </span>
            </TooltipV2>
          )}
        </Show>
      </div>
    </Show>
  )
}

type RunWindow = { key: string; count?: number }

export function RunTree(props: {
  windowKey: string
  windows?: readonly RunWindow[]
  count?: number
  endedAt?: number
  who?: string
  at?: number
  thought?: Thought
}): JSX.Element {
  const windows = createMemo<readonly RunWindow[]>(() => [
    { key: props.windowKey, ...(props.count === undefined ? {} : { count: props.count }) },
    ...(props.windows ?? []),
  ])
  const steps = createMemo(() => {
    const seen = new Set<string>()
    const out: RunStep[] = []
    for (const window of windows())
      for (const step of unwrap(room.runSteps(window.key)) as readonly RunStep[]) {
        if (seen.has(step.id)) continue
        seen.add(step.id)
        out.push(step)
      }
    return out.sort((a, b) => a.startedAt - b.startedAt)
  })
  const short = createMemo(() => windows().filter((w) => room.runSteps(w.key).length < (w.count ?? 0)))
  const total = createMemo(() => windows().reduce((n, w) => n + (w.count ?? 0), 0))
  const working = () => windows().some((w) => room.runLive(w.key))
  const live = createMemo(() => isLive(steps(), working()))
  const openKey = () => runKeyOf(props.windowKey)
  const itemKey = (id: string) => `${openKey()}|${id}`
  const open = createMemo(() => opened().has(openKey()))

  const detailStatus = createMemo<DetailStatus>(() => {
    const missing = short()
    if (missing.length === 0) return "ready"
    if (missing.some((w) => room.runFetching(w.key))) return "loading"
    return missing.every((w) => asked().has(runKeyOf(w.key))) ? "error" : "idle"
  })

  const request = (force = false) => {
    if (!room.runReady()) return
    const missing = short().map((w) => w.key)
    if (missing.length === 0) return
    setAsked((current) =>
      missing.reduce((next, key) => (next.has(runKeyOf(key)) ? next : withKey(next, runKeyOf(key))), current),
    )
    for (const key of missing) room.loadRunSteps(key, force)
  }

  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!live()) return
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(clock))
  })

  const log = createMemo(() =>
    workLogOf(steps(), {
      working: working(),
      count: total(),
      endedAt: props.endedAt,
      detail: detailStatus(),
      known: recallSummary(openKey()),
    }),
  )

  const summary = createMemo(() => {
    const loaded = steps().length >= total()
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

  const liveChildIndex = createMemo(() => {
    const top = path().top
    const child = path().child
    if (top === undefined || child === undefined) return -1
    const worker = log().items.find((item) => item.id === top)
    return worker?.kind === "worker" ? worker.steps.findIndex((step) => step.id === child) : -1
  })

  const runs = createMemo(() => {
    const out: { slug: string; runId: string }[] = []
    for (const window of windows()) {
      const first = room.runSteps(window.key)[0]
      if (first && !out.some((run) => run.runId === first.runId)) out.push({ slug: first.slug, runId: first.runId })
    }
    return out
  })
  const parts = createMemo(() => {
    const held: ThoughtPart[] = []
    const seen = new Set<string>()
    const add = (thought: Thought | undefined) => {
      if (!thought || seen.has(thought.runId)) return
      seen.add(thought.runId)
      held.push(...filledParts(thought))
    }
    add(props.thought)
    for (const run of runs()) add(room.thoughtOfRun(run.runId))
    return held.sort((a, b) => a.startedAt - b.startedAt)
  })

  const thinkingNow = createMemo(() => {
    if (!live() || path().top !== undefined) return false
    const newest = parts().at(-1)
    if (!newest || newest.spentMs > 0) return false
    const lastItem = log().items.at(-1)
    return lastItem === undefined || newest.startedAt >= lastItem.startedAt
  })

  const liveLabel = createMemo(() => (thinkingNow() ? "Thinking" : summaryText(groupSummary(steps())) || "Working"))

  const handoff = untrack(() => {
    const found = room.runEnd(openKey())
    if (!found || untrack(live)) return undefined
    const left = CROSSFADE_MS - (Date.now() - found.at)
    return left > 0 ? { from: found.label, left } : undefined
  })
  const [settling, setSettling] = createSignal(handoff !== undefined)
  const [crossFrom, setCrossFrom] = createSignal(handoff?.from ?? "")
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  if (handoff) {
    setOpen(openKey(), false)
    settleTimer = setTimeout(() => setSettling(false), handoff.left)
  }
  onCleanup(() => clearTimeout(settleTimer))
  createEffect(
    on(
      live,
      (isLive, wasLive) => {
        if (isLive || !wasLive) return
        setCrossFrom(untrack(summary) || untrack(liveLabel))
        setSettling(true)
        setOpen(openKey(), false)
        clearTimeout(settleTimer)
        settleTimer = setTimeout(() => setSettling(false), CROSSFADE_MS)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (live() || !open()) return
    for (const run of runs()) {
      if (room.thoughtOfRun(run.runId)) continue
      room.loadThoughts(run.slug, run.runId)
    }
  })

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
    if (live() || steps().length < total()) return
    const found = summaryOf(steps(), props.endedAt)
    if (found) rememberSummary(openKey(), found)
  })

  createEffect(() => {
    if (!room.runReady() || live() || short().length === 0) return
    untrack(() => request())
  })

  const [whole, setWhole] = createSignal(false)
  const [shownSteps, setShownSteps] = createSignal<ReadonlySet<string>>(new Set())
  const view: View = {
    now,
    seen: () => settling(),
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

  return (
    <div class="run-tree" data-component="run-tree" data-live={live() ? "" : undefined}>
      <Head
        live={live()}
        settling={settling()}
        label={liveLabel()}
        summary={crossFrom()}
        worked={worked()}
        clock={clock()}
        startedAt={startedAt()}
        now={now()}
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
          <div>
            <div class="run-tree-list">
              <Items
                items={log().items}
                parts={parts()}
                view={view}
                steps={steps()}
                live={live()}
                liveTop={path().top}
                liveChild={path().child}
                liveChildIndex={liveChildIndex()}
                whole={whole() || live()}
                onWhole={() => setWhole(true)}
              />
              <Show when={log().missing}>{(missing) => <Missing missing={missing()} onRetry={view.retry} />}</Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
