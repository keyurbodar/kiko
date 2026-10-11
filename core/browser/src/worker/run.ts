import { BROWSER } from "../config"
import { choices, flags } from "../plan/candidates"
import { fastSteps } from "../plan/fast"
import type { Choice, Decider, Decision } from "../decide/types"
import type { PageView, Step, Tab } from "../page/types"
import type { Stop, Task, TaskResult } from "./types"

export type WorkerDeps = {
  decider: Decider
  paused(): boolean
  signal: AbortSignal
  opened?: boolean
  onFast?: (picks: Choice[], page: PageView) => void
}

// A login box in a header must not stop a search: only what is on screen counts.
const secretInView = (page: PageView) =>
  page.controls.some((c) => flags(c.state).includes("secret") && !flags(c.state).includes("offscreen"))

const TICKS = new Set(["checkbox", "radio", "switch"])

function inPage(choice: Choice, page: PageView): boolean {
  const s = choice.step
  if (s.op === "type") return s.text !== "" && !s.submit
  if (s.op === "select") return true
  if (s.op === "click") return TICKS.has(page.controls.find((c) => c.id === s.id)?.role ?? "")
  return false
}

export function chainOf(decision: Decision, page: PageView): Choice[] {
  const out = [decision.choice]
  for (const next of decision.after ?? []) {
    if (out.length >= BROWSER.chainMax || !inPage(out[out.length - 1] as Choice, page)) break
    const op = next.step.op
    if (op === "done" || op === "stuck" || (op === "type" && next.step.text === "")) break
    if (out.some((c) => c.key === next.key)) break
    out.push(next)
  }
  return out
}

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
      if (deps.signal.aborted) return end("paused")
      if (!r.ok) return end(r.reason === "dialog" ? "dialog" : r.reason === "crashed" ? "crashed" : "stuck", { note: `goto ${r.reason}` })
    }
    while (true) {
      if (deps.signal.aborted) return end("paused")
      if (steps >= BROWSER.stepsPerWorker) return end("budget")
      last = fresh ?? (await tab.read())
      fresh = null

      const options = choices(last, task.goal, values)
      const fast = fastSteps(last, task.goal, values, options, actions)
      if (fast.length) deps.onFast?.(fast, last)
      const decision: Decision = fast[0]
        ? { choice: fast[0], confidence: null, runnersUp: [], after: fast.slice(1) }
        : await deps.decider.decide({ goal: task.goal, values, page: last, options, history: actions }, deps.signal)
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
      const chain = chainOf(decision, last)
      let retry = false
      for (const [n, c] of chain.entries()) {
        if (n > 0 && (steps >= BROWSER.stepsPerWorker || deps.paused() || deps.signal.aborted)) break
        if (n > 0) steps++
        const result = await tab.act(c.step as Step)
        if (result.ok) {
          actions.push(c.text)
          continue
        }
        if (result.reason === "dialog") return end("dialog", { note: result.detail })
        if (result.reason === "crashed") return end("crashed", { note: result.detail })
        if (n === 0 && result.reason === "stale" && !staleRetry) {
          retry = true
          steps--
        } else actions.push(`${c.text} failed: ${result.reason}`)
        // A failed step ends the chain: the page is not what the decider saw.
        break
      }
      if (retry) {
        staleRetry = true
        continue
      }
      staleRetry = false

      fresh = await tab.read()
      last = fresh
      unchanged = fresh.key === before ? unchanged + 1 : 0
      if (unchanged >= BROWSER.unchangedLimit) return end("stuck", { note: "the page did not change" })
    }
  } catch (e) {
    if (deps.signal.aborted) return end("paused")
    return end("crashed", { note: e instanceof Error ? e.message : String(e) })
  }
}

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
