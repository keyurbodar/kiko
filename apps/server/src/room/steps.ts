import type { AgentSlug, RunStep, RunStepStatus, ToolKind, WorkerRow } from "@kiko/protocol"

export const STEP_LOG_BYTES = 128 * 1024

const TAIL_LIMIT = 300
const TAIL_WINDOW_MS = 24 * 60 * 60 * 1000

type Row = {
  run_id: string
  id: string
  slug: string
  tool: string
  name: string
  app: string | null
  worker: string | null
  note: number | null
  label: string
  input: string | null
  status: string
  started_at: number
  ended_at: number
  output: string | null
  after_seq: number
}

const COLUMNS =
  "run_id, id, slug, tool, name, app, worker, note, label, input, status, started_at, ended_at, output, after_seq"

const toStep = (r: Row): RunStep => ({
  id: r.id,
  runId: r.run_id,
  slug: r.slug as AgentSlug,
  tool: r.tool as ToolKind,
  name: r.name,
  ...(r.app !== null ? { app: r.app } : {}),
  ...(r.worker !== null ? { worker: JSON.parse(r.worker) as NonNullable<RunStep["worker"]> } : {}),
  ...(r.note ? { note: true as const } : {}),
  label: r.label,
  ...(r.input !== null ? { input: r.input } : {}),
  status: r.status as RunStepStatus,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  ...(r.output !== null ? { output: r.output } : {}),
  after: r.after_seq,
})

const keyOf = (runId: string, id: string) => `${runId}\u0000${id}`
const windowKey = (slug: string, after: number) => `${slug}\u0000${after}`

const byStart = (a: RunStep, b: RunStep) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1)

const DATA_URI = /data:[^\s"')<>]+/gi
const BASE64_RUN = /[A-Za-z0-9+/]{512,}={0,2}/g
const bytesOf = new TextEncoder()

const withoutBytes = (text: string) => text.replace(DATA_URI, "[image]").replace(BASE64_RUN, "[data]")

function storedCard(step: RunStep): RunStep {
  return {
    ...step,
    label: withoutBytes(step.label),
    ...(step.input !== undefined ? { input: withoutBytes(step.input) } : {}),
    ...(step.output !== undefined ? { output: withoutBytes(step.output) } : {}),
  }
}

function shrink(step: RunStep, budget: number): RunStep {
  const card: RunStep = { ...step, label: step.label.slice(0, 160) }
  const half = Math.max(0, Math.floor(budget / 4))
  if (card.input !== undefined) card.input = card.input.slice(0, half)
  if (card.output !== undefined) card.output = card.output.slice(0, Math.max(0, Math.floor(budget / 2)))
  return card
}

export function stepLog(steps: readonly RunStep[]): string | null {
  if (!steps.length) return null
  const kept: RunStep[] = []
  let bytes = 2
  for (let i = steps.length - 1; i >= 0; i--) {
    const separator = kept.length ? 1 : 0
    let card = storedCard(steps[i]!)
    let size = bytesOf.encode(JSON.stringify(card)).length
    if (bytes + separator + size > STEP_LOG_BYTES) {
      if (kept.length) break
      card = shrink(card, STEP_LOG_BYTES - bytes - separator - 16)
      size = bytesOf.encode(JSON.stringify(card)).length
      if (bytes + separator + size > STEP_LOG_BYTES) continue
    }
    kept.push(card)
    bytes += separator + size
  }
  return kept.length ? JSON.stringify(kept.reverse()) : null
}

export function parseStepLog(raw: string | null): RunStep[] | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? (value as RunStep[]) : null
  } catch {
    return null
  }
}

export type HeardStep = Omit<RunStep, "after">

export class RunSteps {
  private readonly sql: SqlStorage
  private readonly running = new Map<string, RunStep>()
  private readonly cards = new Map<string, RunStep[]>()

  constructor(
    storage: DurableObjectStorage,
    readonly roomId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = storage.sql
  }

  private cardList(slug: AgentSlug, after: number): RunStep[] {
    const key = windowKey(slug, after)
    let list = this.cards.get(key)
    if (!list) this.cards.set(key, (list = []))
    return list
  }

  cardsOf(slug: AgentSlug, after: number): readonly RunStep[] {
    return this.cards.get(windowKey(slug, after)) ?? []
  }

  clearWindow(slug: AgentSlug, after: number): void {
    this.cards.delete(windowKey(slug, after))
  }

  start(heard: HeardStep, after: number): RunStep | null {
    const key = keyOf(heard.runId, heard.id)
    if (this.running.has(key)) return null
    if (this.cardsOf(heard.slug, after).some((s) => s.id === heard.id && s.runId === heard.runId)) return null
    const step = { ...heard, after }
    this.running.set(key, step)
    return step
  }

  finish(heard: HeardStep, after: number): { step: RunStep; fresh: boolean } | null {
    const key = keyOf(heard.runId, heard.id)
    const began = this.running.get(key)
    this.running.delete(key)
    const step: RunStep = { ...heard, endedAt: heard.endedAt ?? this.now(), after: began?.after ?? after }
    const list = this.cardList(step.slug, step.after)
    if (list.some((s) => s.id === step.id && s.runId === step.runId)) return began ? { step, fresh: false } : null
    list.push(step)
    return { step, fresh: !began }
  }

  abandon(runId: string): RunStep[] {
    const cut = [...this.running.values()].filter((s) => s.runId === runId && !s.worker)
    return cut.flatMap((s) => this.finish({ ...s, status: "failed", endedAt: this.now() }, s.after)?.step ?? [])
  }

  endWorker(slug: AgentSlug, workerId: string, status: Exclude<WorkerRow["status"], "pending" | "running">): RunStep[] {
    const cut = [...this.running.values()].filter((s) => s.slug === slug && s.worker?.id === workerId)
    return cut.flatMap(
      (s) =>
        this.finish({ ...s, status: status === "done" ? "done" : "failed", endedAt: this.now() }, s.after)?.step ?? [],
    )
  }

  live(slug: AgentSlug, after: number): RunStep[] {
    const running = [...this.running.values()].filter((s) => s.slug === slug && s.after === after)
    return [...this.cardsOf(slug, after), ...running].sort(byStart)
  }

  window(slug: string, after: number): RunStep[] {
    const done = this.sql
      .exec<Row>(
        `SELECT ${COLUMNS} FROM run_steps WHERE room_id = ? AND slug = ? AND after_seq = ?`,
        this.roomId,
        slug,
        after,
      )
      .toArray()
      .map(toStep)
    const own = [...this.running.values()].filter((s) => s.slug === slug && s.after === after)
    return [...done, ...own].sort(byStart)
  }

  count(slug: string, after: number): number {
    const done = this.sql
      .exec<{ n: number }>(
        "SELECT count(*) AS n FROM run_steps WHERE room_id = ? AND slug = ? AND after_seq = ?",
        this.roomId,
        slug,
        after,
      )
      .one().n
    const own = [...this.running.values()].filter((s) => s.slug === slug && s.after === after).length
    return done + own + (this.cards.get(windowKey(slug, after))?.length ?? 0)
  }

  tails(after: ReadonlyMap<string, number>): RunStep[] {
    if (!after.size) return []
    const done = this.sql
      .exec<Row>(
        `SELECT ${COLUMNS} FROM run_steps WHERE room_id = ? AND after_seq IN (SELECT value FROM json_each(?)) AND started_at > ? ORDER BY started_at DESC LIMIT ?`,
        this.roomId,
        JSON.stringify([...new Set(after.values())]),
        this.now() - TAIL_WINDOW_MS,
        TAIL_LIMIT,
      )
      .toArray()
      .map(toStep)
    const memoried = [...after].flatMap(([slug, seq]) => this.cards.get(windowKey(slug, seq)) ?? [])
    return [...done, ...memoried, ...this.running.values()].filter((s) => s.after === after.get(s.slug)).sort(byStart)
  }
}
