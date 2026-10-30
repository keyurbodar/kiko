import { fileName, type LifeLine, type RunStep, type Task } from "@kiko/protocol"
import type { ChatMessage } from "../../lib/types"
import type { HelperLane } from "../helpers/helper-model"
import { liveLabel } from "../run/run-log"

export const FINISH_KEEP_MS = 1_200
export const ALL_DONE_MS = 1_500
const MEMORY_CHIPS = 6

export function knowns(lines: readonly LifeLine[]): { shown: LifeLine[]; more: number } {
  const live = lines.filter((line) => !line.redacted && line.supersededBy == null)
  const ordered = [...live.filter((line) => line.pinned), ...live.filter((line) => !line.pinned)]
  return { shown: ordered.slice(0, MEMORY_CHIPS), more: Math.max(0, ordered.length - MEMORY_CHIPS) }
}

export type NowRow = { slug: string; line: string; since: number }

export function nowRows(input: {
  slugs: readonly string[]
  lines: readonly (string | undefined)[]
  since: (slug: string) => number | undefined
  fallback: number
}): NowRow[] {
  return input.slugs.map((slug, at) => ({
    slug,
    line: input.lines[at] ?? "Working",
    since: input.since(slug) ?? input.fallback,
  }))
}

export type ProgressView = {
  open: readonly Task[]
  done: readonly Task[]
  total: number
  completed: number
  currentId: string | null
  allDone: boolean
}

export function progressView(tasks: readonly Task[], running: boolean): ProgressView {
  const steps = tasks.filter((task) => task.status !== "cancelled")
  const open = steps.filter((task) => task.status !== "done")
  const done = steps.filter((task) => task.status === "done")
  return {
    open,
    done,
    total: steps.length,
    completed: done.length,
    currentId: running ? (open[0]?.id ?? null) : null,
    allDone: steps.length > 0 && open.length === 0,
  }
}

export type HelperSplit = { shown: readonly HelperLane[]; finished: readonly HelperLane[]; working: number }

export function helperSplit(lanes: readonly HelperLane[], now: number): HelperSplit {
  const working = lanes.filter((lane) => lane.state === "working")
  const finished = lanes.filter((lane) => lane.state !== "working")
  const lingering = finished.filter((lane) => lane.endedAt !== undefined && now - lane.endedAt < FINISH_KEEP_MS)
  const shown = [...working, ...lingering].toSorted((a, b) => a.startedAt - b.startedAt)
  return { shown, finished, working: working.length }
}

export function agentFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return files.filter((file) => !file.name.startsWith("attachments/"))
}

export function outputTiles<T>(files: readonly T[], slots: number): { shown: readonly T[]; more: number } {
  const newest = files.toReversed()
  if (newest.length <= slots) return { shown: newest, more: 0 }
  return { shown: newest.slice(0, slots - 1), more: newest.length - (slots - 1) }
}

export type UsedItem = { id: string; name: string; meta: string }
export type UsedKind = "uploads" | "web" | "pages" | "memory"
export type UsedRow = { kind: UsedKind; label: string; summary: string; items: readonly UsedItem[] }

const PAGE_NAMES = new Set(["browse", "browser_look"])
const MEMORY_NAMES = new Set(["recall", "note", "zoom"])
const isSearch = (step: Pick<RunStep, "name">) => step.name.startsWith("composio_") && /search/i.test(step.name)

const args = (step: Pick<RunStep, "input">): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(step.input ?? "")
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null)

function queryOf(step: RunStep): string {
  const input = args(step)
  return text(input.query) ?? text(input.q) ?? text(input.url) ?? liveLabel(step)
}

function pageOf(step: RunStep): string {
  const input = args(step)
  const urls = input.urls
  const first = Array.isArray(urls) ? text(urls[0]) : null
  return first ?? text(input.url) ?? liveLabel(step)
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function usedRows(messages: readonly ChatMessage[], steps: readonly RunStep[]): UsedRow[] {
  const uploads: UsedItem[] = []
  for (const message of messages) {
    if (message.sender !== "user" || !message.files?.length) continue
    for (const file of message.files) {
      const id = file.path ?? file.name
      if (uploads.some((item) => item.id === id)) continue
      uploads.push({ id, name: fileName(file.name), meta: "Upload" })
    }
  }
  const searches = steps.filter(isSearch)
  const pages = steps.filter((step) => PAGE_NAMES.has(step.name))
  const facts = steps.filter((step) => MEMORY_NAMES.has(step.name))
  const rows: UsedRow[] = []
  if (uploads.length > 0) {
    const names = uploads.map((item) => item.name)
    const summary = names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`
    rows.push({ kind: "uploads", label: "Uploads", summary, items: uploads })
  }
  if (searches.length > 0) {
    rows.push({
      kind: "web",
      label: "Web search",
      summary: plural(searches.length, "search", "searches"),
      items: searches.map((step) => ({
        id: `${step.runId}:${step.id}`,
        name: queryOf(step),
        meta: "Search",
      })),
    })
  }
  if (pages.length > 0) {
    rows.push({
      kind: "pages",
      label: "Pages read",
      summary: plural(pages.length, "page", "pages"),
      items: pages.map((step) => ({ id: `${step.runId}:${step.id}`, name: pageOf(step), meta: "Page" })),
    })
  }
  if (facts.length > 0) {
    rows.push({
      kind: "memory",
      label: "Memory",
      summary: `Read: ${liveLabel(facts[0]!)}`,
      items: facts.map((step) => ({
        id: `${step.runId}:${step.id}`,
        name: liveLabel(step),
        meta: "Fact",
      })),
    })
  }
  return rows
}
