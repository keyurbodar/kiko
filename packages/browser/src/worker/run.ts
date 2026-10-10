import { BROWSER } from "../config"
import { choices } from "../plan/candidates"
import type { Decider, Decision } from "../decide/types"
import type { PageView, Step, Tab } from "../page/types"
import type { Stop, Task, TaskResult } from "./types"

export type WorkerDeps = {
  decider: Decider
  paused(): boolean
  signal: AbortSignal
  now?: () => number
  /** Each tab was opened at its task's url (openTab(url)), so the worker does not navigate there again. */
  opened?: boolean
}

const flags = (state?: string) => state?.split(" ") ?? []

/**
 * The page script marks password, payment and one-time-code fields "secret". They are never choices.
 * A worker that cannot go on while one is on screen hands the page to the human, so a login box in a
 * header does not stop a search.
 */
const secretInView = (page: PageView) =>
  page.controls.some((c) => flags(c.state).includes("secret") && !flags(c.state).includes("offscreen"))

export async function runTask(tab: Tab, task: Task, deps: WorkerDeps): Promise<TaskResult> {
  const values = task.values ?? {}
  const actions: string[] = []
  let last: PageView = { key: "", url: task.url ?? "", title: "", controls: [], text: "", omitted: 0 }
  const end = (stop: Stop, extra: Partial<TaskResult> = {}): TaskResult => ({
    stop: (stop === "stuck" || stop === "unsure") && secretInView(last) ? "needs_human" : stop,
    url: last.url,
    title: last.title,
    actions,
    ...extra,
  })

  let unchanged = 0
  let steps = 0
  let staleRetry = false
  // The read taken after an action doubles as the read before the next decision.
  let fresh: PageView | null = null

  try {
    if (task.url && !deps.opened) {
      const r = await tab.act({ op: "goto", url: task.url })
      if (!r.ok) return end(r.reason === "dialog" ? "dialog" : r.reason === "crashed" ? "crashed" : "stuck", { note: `goto ${r.reason}` })
    }
    while (true) {
      if (deps.signal.aborted) return end("paused")
      if (steps >= BROWSER.stepsPerWorker) return end("budget")
      last = fresh ?? (await tab.read())
      fresh = null

      let decision: Decision
      try {
        decision = await deps.decider.decide(
          { goal: task.goal, values, page: last, options: choices(last, task.goal, values), history: actions },
          deps.signal,
        )
      } catch (e) {
        if (deps.signal.aborted) return end("paused")
        throw e
      }
      steps++
      const { choice } = decision
      const step = choice.step

      if (decision.confidence !== null && decision.confidence < BROWSER.confidenceFloor) {
        const top = [choice, ...decision.runnersUp].slice(0, 3).map((c) => c.text)
        return end("unsure", { options: top })
      }
      if (step.op === "done") return end("done")
      if (step.op === "stuck") return end("stuck")
      if (step.op === "type" && step.text === "") return end("needs_value", { note: choice.text })
      if (deps.paused()) return end("paused")

      const before = last.key
      const result = await tab.act(step as Step)
      if (!result.ok) {
        if (result.reason === "dialog") return end("dialog", { note: result.detail })
        if (result.reason === "crashed") return end("crashed", { note: result.detail })
        if (result.reason === "stale" && !staleRetry) {
          // The page moved under us. Read again and decide again, once.
          staleRetry = true
          steps--
          continue
        }
        actions.push(`${choice.text} failed: ${result.reason}`)
      } else {
        actions.push(choice.text)
      }
      staleRetry = false

      fresh = await tab.read()
      last = fresh
      unchanged = fresh.key === before ? unchanged + 1 : 0
      if (unchanged >= BROWSER.unchangedLimit) return end("stuck", { note: "the page did not change" })
    }
  } catch (e) {
    return end("crashed", { note: e instanceof Error ? e.message : String(e) })
  }
}

/** Up to workersPerRun tasks at the same time. Results keep the order of the tasks. */
export async function runTasks(tabs: Tab[], tasks: Task[], deps: WorkerDeps): Promise<TaskResult[]> {
  const n = Math.min(tasks.length, tabs.length, BROWSER.workersPerRun)
  const ran = await Promise.all(tasks.slice(0, n).map((t, i) => runTask(tabs[i], t, deps)))
  const skipped: TaskResult[] = tasks.slice(n).map((t) => ({
    stop: "budget",
    url: t.url ?? "",
    title: "",
    actions: [],
    note: `not started: at most ${n} tasks run at once`,
  }))
  return [...ran, ...skipped]
}
