import type { HumanAsk, LifeLine, Task } from "@kiko/protocol"
import type { HelperLane } from "../helpers/helper-model"
import { taskProgress } from "../info/tasks-model"

const FILE_TILES = 4

export function fileTiles<T>(files: readonly T[]): { shown: readonly T[]; more: number } {
  const newest = files.toReversed()
  return { shown: newest.slice(0, FILE_TILES), more: Math.max(0, newest.length - FILE_TILES) }
}

const TASK_ROWS = 5
const RANK: Record<string, number> = { doing: 0, blocked: 1, review: 2, todo: 3, done: 4 }

export function deskTasks(tasks: readonly Task[]) {
  const { steps, completed, total } = taskProgress(tasks)
  const ranked = steps
    .map((task, at) => ({ task, at }))
    .toSorted((a, b) => (RANK[a.task.status] ?? 5) - (RANK[b.task.status] ?? 5) || a.at - b.at)
    .map((entry) => entry.task)
  return { shown: ranked.slice(0, TASK_ROWS), completed, total, more: Math.max(0, total - TASK_ROWS) }
}

export function nowProgress(tasks: readonly Task[]): number | null {
  const { completed, total } = taskProgress(tasks)
  return total > 0 && completed < total ? completed / total : null
}

export type Waiting = { ask: HumanAsk; choices: readonly string[] }

export function waiting(asks: readonly HumanAsk[]): Waiting[] {
  return asks.map((ask) => ({ ask, choices: ask.questions ? [] : (ask.options ?? []).slice(0, 3) }))
}

export type TaskMark = "todo" | "doing" | "partial" | "done" | "waiting"

export function taskMark(task: Pick<Task, "status" | "owner">, asking: ReadonlySet<string>): TaskMark {
  if (task.status === "done") return "done"
  if (task.status === "blocked") return "waiting"
  if (task.status === "doing") return task.owner !== undefined && asking.has(task.owner) ? "waiting" : "doing"
  return task.status === "review" ? "partial" : "todo"
}

export type DeskMode = "working" | "done"

export function deskMode(input: {
  running: boolean
  tasks: readonly Pick<Task, "status">[]
  lanes: readonly Pick<HelperLane, "state">[]
  asks: number
}): DeskMode {
  const busy =
    input.running ||
    input.asks > 0 ||
    input.lanes.some((lane) => lane.state === "working") ||
    input.tasks.some((task) => task.status === "doing")
  return busy ? "working" : "done"
}

export function tasksLine(tasks: readonly Task[]): string {
  const { completed, total } = taskProgress(tasks)
  if (total === 0) return "No tasks"
  if (completed === total) return total === 1 ? "The task is done" : `All ${total} tasks done`
  return `${completed} of ${total} tasks done`
}

const MEMORY_CHIPS = 6

export function knowns(lines: readonly LifeLine[]): { shown: LifeLine[]; more: number } {
  const live = lines.filter((l) => !l.redacted && l.supersededBy == null)
  const ordered = [...live.filter((l) => l.pinned), ...live.filter((l) => !l.pinned)]
  return { shown: ordered.slice(0, MEMORY_CHIPS), more: Math.max(0, ordered.length - MEMORY_CHIPS) }
}
