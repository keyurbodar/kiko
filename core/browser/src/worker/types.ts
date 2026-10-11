export type Task = { goal: string; url?: string; values?: Record<string, string> }

export type Stop =
  | "done"
  | "unsure"
  | "stuck"
  | "needs_value"
  | "needs_human"
  | "dialog"
  | "budget"
  | "paused"
  | "crashed"

export type TaskResult = {
  stop: Stop
  url: string
  title: string
  actions: string[]
  note?: string
  options?: string[]
}
