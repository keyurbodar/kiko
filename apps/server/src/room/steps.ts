import type { AgentSlug, RunStep, RunStepStatus, ToolKind, WorkerRow } from "@kiko/protocol"

const KEEP_STEPS = 2_000
const HIGH_WATER = 2_200
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

const byStart = (a: RunStep, b: RunStep) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1)

export type HeardStep = Omit<RunStep, "after">

export class RunSteps {
  private readonly sql: SqlStorage
  private readonly running = new Map<string, RunStep>()
  private stored: number | null = null

  constructor(
    storage: DurableObjectStorage,
    readonly roomId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = storage.sql
  }

  private isStored(runId: string, id: string): boolean {
    return (
      this.sql
        .exec("SELECT 1 FROM run_steps WHERE room_id = ? AND run_id = ? AND id = ?", this.roomId, runId, id)
        .toArray().length > 0
    )
  }

  start(heard: HeardStep, after: number): RunStep | null {
    const key = keyOf(heard.runId, heard.id)
    if (this.running.has(key) || this.isStored(heard.runId, heard.id)) return null
    const step = { ...heard, after }
    this.running.set(key, step)
    return step
  }

  finish(heard: HeardStep, after: number): { step: RunStep; fresh: boolean } | null {
    const key = keyOf(heard.runId, heard.id)
    const began = this.running.get(key)
    this.running.delete(key)
    const step: RunStep = { ...heard, endedAt: heard.endedAt ?? this.now(), after: began?.after ?? after }
    const cursor = this.sql.exec(
      `INSERT INTO run_steps (room_id, ${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (room_id, run_id, id) DO NOTHING`,
      this.roomId,
      step.runId,
      step.id,
      step.slug,
      step.tool,
      step.name,
      step.app ?? null,
      step.worker ? JSON.stringify(step.worker) : null,
      step.note ? 1 : null,
      step.label,
      step.input ?? null,
      step.status,
      step.startedAt,
      step.endedAt,
      step.output ?? null,
      step.after,
    )
    cursor.toArray()
    if (cursor.rowsWritten === 0) return null
    this.prune()
    return { step, fresh: !began }
  }

  private prune(): void {
    this.stored =
      this.stored === null
        ? this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM run_steps WHERE room_id = ?", this.roomId).one().n
        : this.stored + 1
    if (this.stored <= HIGH_WATER) return
    this.sql.exec(
      "DELETE FROM run_steps WHERE room_id = ? AND (started_at, run_id, id) <= (SELECT started_at, run_id, id FROM run_steps WHERE room_id = ? ORDER BY started_at DESC, run_id DESC, id DESC LIMIT 1 OFFSET ?)",
      this.roomId,
      this.roomId,
      KEEP_STEPS,
    )
    this.stored = KEEP_STEPS
  }

  abandon(runId: string): RunStep[] {
    const cut = [...this.running.values()].filter((s) => s.runId === runId && !s.worker)
    return cut.flatMap((s) => this.finish({ ...s, status: "failed", endedAt: this.now() }, s.after)?.step ?? [])
  }

  endWorker(slug: string, workerId: string, status: Exclude<WorkerRow["status"], "pending" | "running">): RunStep[] {
    const cut = [...this.running.values()].filter((s) => s.slug === slug && s.worker?.id === workerId)
    return cut.flatMap(
      (s) =>
        this.finish({ ...s, status: status === "done" ? "done" : "failed", endedAt: this.now() }, s.after)?.step ?? [],
    )
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
    return done + [...this.running.values()].filter((s) => s.slug === slug && s.after === after).length
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
    return [...done, ...this.running.values()].filter((s) => s.after === after.get(s.slug)).sort(byStart)
  }
}
