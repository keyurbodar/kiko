import type { RunStep } from "@kiko/protocol"
import { anyRunning, buildEntries, type Entry, extraInput, iconOf, liveLabel, pathOf, type StepIcon, summarizeSteps } from "./run-log"

/*
 * The run tree as data: the rows the thread draws under an agent's bubble for the steps that led
 * to it. While the agent still works on them the tree shows the newest few and folds the rest
 * under one row. Once a bubble opens them and nothing runs, the tree is one sentence that opens the
 * whole list. Nothing here touches the DOM, so every rule has a table in `run-tree-rows.test.ts`.
 */

/** How many entries a live tree shows. Older ones fold under one row. */
export const LIVE_ROWS = 3

/** A row of the tree: a call, a background worker's work, the words a run wrote between two calls, or the wait for the rest. */
export type TreeRow = {
  kind: "step" | "worker" | "note" | "loading"
  /** The step's or worker's id, which keys what the reader has opened. */
  id: string
  label: string
  /** The glyph after the label. A note and the wait have none. */
  icon?: StepIcon
  /** Still going, so its label shines. */
  running: boolean
  /** The file or folder the call touched, which a click opens. */
  target?: { path: string; folder: boolean }
  /** What opens under the row: a call's input and output, or the labels of a worker's calls. */
  detail?: { input?: string; output?: string; failed: boolean; running: boolean; lines?: string[] }
}

/** The row on top that opens and closes the folded rows: "2 earlier steps" while live, the run's summary once done. */
export type TreeHead = { kind: "fold" | "summary"; label: string; open: boolean; failed: boolean }

export type Tree = {
  head?: TreeHead
  /** The rows the head opens. They show only while it is open. */
  folded: TreeRow[]
  /** The rows that always show, under the folded ones. */
  shown: TreeRow[]
}

export type TreeState = {
  /** The agent is mid-run and no bubble opens the window yet: `useApp.runLive`. */
  working: boolean
  /** The reader opened the head. */
  open: boolean
  /** How many steps the bubble says its window has: `Message.steps`. Absent under the typing bubble. */
  count?: number
  /** The window's steps are on their way: `useApp.runFetching`. */
  fetching?: boolean
}

/** A window is live while its agent works on it, or while any of its steps, a worker's included, still runs. */
export const isLive = (steps: readonly Pick<RunStep, "status">[], working: boolean): boolean => working || anyRunning(steps)

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const NO_WORKER_OPEN: ReadonlySet<string> = new Set()

const LOADING: TreeRow = { kind: "loading", id: "loading", label: "Loading steps…", running: true }

function rowOf(entry: Entry): TreeRow {
  if (entry.kind === "worker") {
    const running = anyRunning(entry.steps)
    const failed = entry.steps.some((s) => s.status === "failed")
    return { kind: "worker", id: entry.id, label: entry.task, icon: "worker", running, detail: { failed, running, lines: entry.steps.map(liveLabel) } }
  }
  const { step } = entry
  const target = pathOf(step)
  const running = step.status === "running"
  return {
    kind: step.note ? "note" : "step",
    id: step.id,
    label: liveLabel(step),
    icon: iconOf(step),
    running,
    ...(target ? { target } : {}),
    ...(step.note ? {} : { detail: { input: extraInput(step), output: step.output, failed: step.status === "failed", running } }),
  }
}

const failedIn = (entries: readonly Entry[]) => entries.some((e) => (e.kind === "worker" ? e.steps : [e.step]).some((s) => s.status === "failed"))

/**
 * The rows for one window of steps. Live: the newest `LIVE_ROWS` entries, each background worker
 * as one row, and every older entry under a head that counts them. Done: a head with the run's
 * summary over every entry, or with the bubble's count while this client holds fewer steps than it
 * says, and a shining wait at the end while the rest are on their way.
 */
export function treeOf(steps: readonly RunStep[], state: TreeState): Tree {
  const entries = buildEntries(steps, NO_WORKER_OPEN)
  const rows = entries.map(rowOf)
  if (isLive(steps, state.working)) {
    const hidden = Math.max(0, rows.length - LIVE_ROWS)
    if (hidden === 0) return { folded: [], shown: rows }
    const head: TreeHead = { kind: "fold", label: plural(hidden, "earlier step", "earlier steps"), open: state.open, failed: failedIn(entries.slice(0, hidden)) }
    return { head, folded: rows.slice(0, hidden), shown: rows.slice(hidden) }
  }
  const count = Math.max(state.count ?? 0, steps.length)
  if (count === 0) return { folded: [], shown: [] }
  const missing = steps.length < count
  const { summary, hasFailure } = summarizeSteps(steps)
  const head: TreeHead = { kind: "summary", label: !missing && summary ? summary : plural(count, "step", "steps"), open: state.open, failed: hasFailure }
  return { head, folded: missing && state.fetching ? [...rows, LOADING] : rows, shown: [] }
}
