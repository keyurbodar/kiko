import type { RunStep, ToolKind } from "@kiko/protocol"

/*
 * The run log as data: what each step looks like, how a run reads in one sentence, and how steps
 * merge. Ported from t3code's work log (`summarizeToolGroup`, `liveWorkEntryLabel`), cut to kiko's
 * six tool kinds. Nothing here touches the DOM, so every rule has a table in `run-log.test.ts`.
 */

export type StepIcon = "eye" | "pen" | "terminal" | "search" | "globe" | "wrench" | "alert"

/** t3code's icons: read is an eye, edit a pen, run a terminal, search a magnifier, web a globe, other a wrench. */
export const STEP_ICON: Record<ToolKind, StepIcon> = {
  read: "eye",
  edit: "pen",
  run: "terminal",
  search: "search",
  web: "globe",
  other: "wrench",
}

/** A failed call shows the alert glyph in place of its kind's. */
export const iconOf = (step: Pick<RunStep, "tool" | "status">): StepIcon => (step.status === "failed" ? "alert" : STEP_ICON[step.tool])

// Summary

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The sentence part for each kind, and how early it is picked when a run did more than two kinds of thing. */
const GROUPS: Record<ToolKind, { label: (count: number) => string; priority: number }> = {
  run: { label: (n) => `Ran ${plural(n, "command", "commands")}`, priority: 0 },
  edit: { label: (n) => `Changed ${plural(n, "file", "files")}`, priority: 0 },
  read: { label: (n) => `Read ${plural(n, "file", "files")}`, priority: 1 },
  search: { label: (n) => `Searched code ${plural(n, "time", "times")}`, priority: 1 },
  web: { label: (n) => `Searched the web ${plural(n, "time", "times")}`, priority: 1 },
  other: { label: (n) => `Used ${plural(n, "tool", "tools")}`, priority: 2 },
}

/**
 * t3code's `summarizeToolGroup`: at most two kinds of action, picked by priority and shown in the
 * order they first appeared, then "Performed N other actions" for every call left over.
 */
export function summarizeSteps(steps: readonly Pick<RunStep, "tool" | "status">[]): { summary: string; hasFailure: boolean } {
  const groups = new Map<ToolKind, number>()
  for (const step of steps) groups.set(step.tool, (groups.get(step.tool) ?? 0) + 1)
  const all = [...groups].map(([tool, count], index) => ({ index, count, priority: GROUPS[tool].priority, label: GROUPS[tool].label(count) }))
  const picked = [...all]
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
  const labels: string[] = picked.map((g) => g.label)
  const rest = steps.length - picked.reduce((n, g) => n + g.count, 0)
  if (rest > 0) labels.push(`Performed ${plural(rest, "other action", "other actions")}`)
  const sentence = labels.map((label, i) => (i === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)))
  const summary = sentence.length < 3 ? sentence.join(" and ") : `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`
  return { summary, hasFailure: steps.some((s) => s.status === "failed") }
}

// Live labels

/** The label's first word in the past tense, and the same word while the call runs. */
const PRESENT: Record<string, string> = {
  Read: "Reading",
  Ran: "Running",
  Edited: "Editing",
  Wrote: "Writing",
  Created: "Creating",
  Deleted: "Deleting",
  Moved: "Moving",
  Renamed: "Renaming",
  Listed: "Listing",
  Searched: "Searching",
  Fetched: "Fetching",
  Opened: "Opening",
  Browsed: "Browsing",
  Used: "Using",
  Called: "Calling",
  Sent: "Sending",
  Checked: "Checking",
  Updated: "Updating",
  Saved: "Saving",
  Loaded: "Loading",
}

const WRAPPERS = new Set(["sudo", "env", "time", "command", "exec", "nohup"])
const SKIPPED = new Set(["cd", "export", "set"])

/** The program a shell command starts, such as "bun" for `cd app && FOO=1 bun test`. */
export function programOf(command: string): string | undefined {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((w) => w && !/^\w+=/.test(w) && !WRAPPERS.has(w))
    const first = words[0]?.replace(/^["']|["']$/g, "")
    if (!first || SKIPPED.has(first)) continue
    return first.split("/").pop() || undefined
  }
  return undefined
}

/** What a step says while it runs: "Reading /plan.md", "Running bun". A finished step keeps its own label. */
export function liveLabel(step: Pick<RunStep, "tool" | "label" | "input" | "status">): string {
  if (step.status !== "running") return step.label
  if (step.tool === "run") return `Running ${programOf(step.input ?? step.label.replace(/^Ran\s+/, "")) ?? "command"}`
  const space = step.label.indexOf(" ")
  const verb = space === -1 ? step.label : step.label.slice(0, space)
  const present = PRESENT[verb]
  if (!present) return step.label
  return space === -1 ? present : `${present}${step.label.slice(space)}`
}

/** Input worth showing under the label: only when it says more than the label does. */
export function extraInput(step: Pick<RunStep, "label" | "input">): string | undefined {
  const input = step.input?.trim()
  if (!input) return undefined
  const label = step.label.trim()
  if (label === input || label.endsWith(` ${input}`)) return undefined
  return input
}

// Time

/** t3code's `formatDuration`: 420ms, 3.4s, 42s, 1m 5s, 2h 3m. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms"
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 10_000) {
    const tenths = Math.round(ms / 100) / 10
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`
  }
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const total = Math.round(ms / 1000)
  const parts: string[] = []
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0) parts.push(`${s}s`)
  return parts.join(" ")
}

/** The running clock in the header, in whole seconds so it ticks once a second: 0s, 12s, 1m 5s. */
export function formatClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds * 1000)
}

export const startOf = (steps: readonly Pick<RunStep, "startedAt">[]): number | undefined => (steps.length ? Math.min(...steps.map((s) => s.startedAt)) : undefined)

/** Start of the first step to end of the last. Undefined while any step is running. */
export function totalDuration(steps: readonly Pick<RunStep, "startedAt" | "endedAt" | "status">[]): number | undefined {
  if (!steps.length || steps.some((s) => s.status === "running")) return undefined
  const end = Math.max(...steps.map((s) => s.endedAt ?? s.startedAt))
  return end - (startOf(steps) ?? end)
}

// Merging

const rank = (step: Pick<RunStep, "status">) => (step.status === "running" ? 0 : 1)

/** Array.sort is stable, so steps that start in the same millisecond keep the order they came in. */
const byStart = (a: RunStep, b: RunStep) => a.startedAt - b.startedAt

/**
 * A run's steps with `step` in: replaced by id, in start order. A frame that arrives late never
 * takes a finished step back to running.
 */
export function upsertStep(steps: readonly RunStep[], step: RunStep): RunStep[] {
  const at = steps.findIndex((s) => s.id === step.id)
  if (at === -1) return [...steps, step].sort(byStart)
  if (rank(step) < rank(steps[at])) return [...steps]
  const next = [...steps]
  next[at] = step
  return next.sort(byStart)
}
