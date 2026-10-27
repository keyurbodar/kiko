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
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { findFile } from "../ui/find-file"
import { HelperLanes } from "../helpers/HelperLanes"
import { Mochi } from "../ui/Mochi"
import { durationLabel, elapsedLabel, fullTimeLabel } from "./duration"
import { GLYPH } from "./glyphs"
import type { StepIcon } from "./run-log"
import {
  type DetailStatus,
  isLive,
  type LabelPart,
  type NoteItem,
  type RowDetail,
  type StepItem,
  summaryOf,
  type WorkerItem,
  type WorkHead,
  type WorkItem,
  workLogOf,
} from "./run-tree-rows"
import { recallSummary, rememberSummary } from "./run-summary"
import { Shine } from "./Shine"
import "./run-tree.css"

const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
const [asked, setAsked] = createSignal<ReadonlySet<string>>(new Set())

const MAX_OPENED = 100
const FRESH_MS = 1_200
const LONG_LIST = 10
const SHORT_LIST = 6
const COPIED_MS = 1_200

const PILL =
  "cursor-pointer rounded-row bg-active px-2.5 py-0.5 text-fg transition-transform hover:bg-hover active:scale-[0.97]"

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

const openedLive = new Set<string>()

export function toggleRun(windowKey: string): void {
  const key = runKeyOf(windowKey)
  const next = !runOpen(windowKey)
  if (next) openedLive.add(key)
  else openedLive.delete(key)
  setOpen(key, next)
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
        class="run-tree-time"
        data-component="run-tree-time"
        data-live={props.running ? "" : undefined}
        title={fullTimeLabel(props.startedAt)}
      >
        {props.running ? elapsedLabel(ms()) : durationLabel(ms())}
      </span>
    </Show>
  )
}

function Leaves(props: { running: boolean }) {
  return (
    <span class="run-tree-icon run-tree-leaves" data-running={props.running ? "" : undefined} aria-hidden="true">
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

function CopyCommand(props: { text: string }) {
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
      aria-label={copied() ? "Copied" : "Copy command"}
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
                <CopyCommand text={input()} />
              </div>
            )}
          </Show>
          <Show when={props.detail.output}>
            {(output) => <pre class="run-tree-mono run-tree-output">{output()}</pre>}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function StepRow(props: { step: StepItem; view: View }) {
  const open = () => props.view.isOpen(props.step.id)
  const opensFile = () => !!props.step.target && !props.step.target.folder
  const born = untrack(() => fresh(props.step.startedAt, props.view.now()))
  const settled = () => fresh(props.step.endedAt, props.view.now())
  return (
    <div class="run-tree-item" data-kind="step" data-fresh={born ? "" : undefined}>
      <button
        type="button"
        class="run-tree-row"
        data-kind="step"
        data-running={props.step.running ? "" : undefined}
        data-settled={settled() && !props.step.running ? "" : undefined}
        data-failed={props.step.failed ? "" : undefined}
        data-file={props.step.target ? "" : undefined}
        aria-expanded={props.step.target ? undefined : open()}
        data-disclosure=""
        title={opensFile() ? `Open ${props.step.target!.path}` : undefined}
        onClick={() => props.view.openStep(props.step)}
      >
        <Icon icon={props.step.icon} running={props.step.running} failed={props.step.failed} settled={settled()} />
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

function WorkerRow(props: { worker: WorkerItem; view: View }) {
  const open = () => props.view.isOpen(props.worker.id)
  return (
    <div class="run-tree-item" data-kind="worker">
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
          <Leaves running={props.worker.running} />
        </span>
        <Label text={props.worker.label} running={props.worker.running} />
        <Show when={props.worker.meta}>{(meta) => <span class="run-tree-meta">{meta()}</span>}</Show>
        <Chevron open={open()} />
        <Took
          startedAt={props.worker.startedAt}
          endedAt={props.worker.endedAt}
          running={props.worker.running}
          now={props.view.now()}
        />
      </button>
      <Show when={open()}>
        <div class="run-tree-children">
          <Index each={props.worker.steps}>{(step) => <StepRow step={step()} view={props.view} />}</Index>
        </div>
      </Show>
    </div>
  )
}

function NoteRow(props: { note: NoteItem }) {
  return (
    <p class="run-tree-item run-tree-said" data-kind="note">
      {props.note.text}
    </p>
  )
}

function Items(props: { items: readonly WorkItem[]; view: View; whole: boolean; onWhole: () => void }) {
  const long = () => !props.whole && props.items.length > LONG_LIST
  const shown = () => (long() ? props.items.slice(0, SHORT_LIST) : props.items)
  return (
    <>
      <Index each={shown()}>
        {(item) => (
          <Switch>
            <Match when={item().kind === "step" && (item() as StepItem)}>
              {(step) => <StepRow step={step()} view={props.view} />}
            </Match>
            <Match when={item().kind === "note" && (item() as NoteItem)}>{(note) => <NoteRow note={note()} />}</Match>
            <Match when={item().kind === "worker" && (item() as WorkerItem)}>
              {(worker) => <WorkerRow worker={worker()} view={props.view} />}
            </Match>
          </Switch>
        )}
      </Index>
      <Show when={long()}>
        <button type="button" class="run-tree-row run-tree-more" onClick={() => props.onWhole()}>
          <span class="run-tree-slot" />
          <span class="run-tree-label">Show all steps</span>
        </button>
      </Show>
    </>
  )
}

function Missing(props: { missing: "loading" | "error"; onRetry: () => void }) {
  return (
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
  )
}

const tookOf = (head: WorkHead) =>
  head.startedAt !== undefined && head.endedAt !== undefined && head.endedAt >= head.startedAt
    ? durationLabel(head.endedAt - head.startedAt)
    : undefined

function headLabel(head: WorkHead, who: string | undefined): string {
  const took = tookOf(head)
  if (head.summary) return who ? `${who} ${head.summary.charAt(0).toLowerCase()}${head.summary.slice(1)}` : head.summary
  const worked = who ? `${who} worked` : "Worked"
  return took ? `${worked} for ${took}` : worked
}

export function RunTree(props: {
  windowKey: string
  count?: number
  endedAt?: number
  who?: string
  at?: number
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

  createEffect(() => {
    if (live() || steps().length < (props.count ?? 0)) return
    const summary = summaryOf(steps(), props.endedAt)
    if (summary) rememberSummary(openKey(), summary)
  })

  createEffect(() => {
    if (!live() && steps().length < (props.count ?? 0)) untrack(() => request())
  })

  const [fold, setFold] = createSignal<Fold>(untrack(open) ? "open" : "gone")
  let clicked = false
  let list: HTMLDivElement | undefined
  createEffect(
    on(
      open,
      (isOpen) => {
        const moves = clicked
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
    clicked = false
  }

  const [replying, setReplying] = createSignal(false)
  createEffect(() => {
    if (live() || !openedLive.has(openKey())) return
    const key = openKey()
    openedLive.delete(key)
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setReplying(true)
        clicked = true
        setOpen(key, false)
        clicked = false
      })
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })
  createEffect(() => {
    if (fold() === "gone") setReplying(false)
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
      <Items items={log().items} view={view} whole={whole() || live()} onWhole={() => setWhole(true)} />
      <Show when={log().missing}>{(missing) => <Missing missing={missing()} onRetry={view.retry} />}</Show>
    </div>
  )

  return (
    <div class="run-tree" data-component="run-tree" data-live={live() ? "" : undefined}>
      <Show when={!live() && log().head}>
        {(head) => (
          <button
            type="button"
            class="run-tree-head"
            aria-expanded={open()}
            data-disclosure=""
            title={props.at ? fullTimeLabel(props.at) : undefined}
            onClick={toggleHead}
          >
            <span class="run-tree-summary">{headLabel(head(), props.who)}</span>
            <Show when={head().summary && tookOf(head())}>{(took) => <span class="run-tree-took">{took()}</span>}</Show>
            <Chevron open={open()} />
          </button>
        )}
      </Show>
      <Show when={live() ? open() && log().items.length > 0 : fold() !== "gone"}>
        <div
          ref={list}
          class="run-tree-fold motion-run-fold"
          data-grow={fold() === "grow" || live() ? "" : undefined}
          data-shut={!live() && fold() === "shut" ? "" : undefined}
          data-reply={replying() ? "" : undefined}
        >
          <div>{body()}</div>
        </div>
      </Show>
      <HelperLanes lanes={lanes()} now={now()} />
    </div>
  )
}
