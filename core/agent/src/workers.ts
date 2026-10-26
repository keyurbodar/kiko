import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import {
  AssistantEntry,
  type ConversationId,
  type Harness,
  type SettledSubmissionRecord,
  type SubmissionId,
} from "@earendil-works/pi-durable"
import type { Envelope } from "./envelope"
import { type Step } from "@kiko/durable/migrate"
import { WorkerMissing } from "./errors"

const context = BACKGROUND_CONTEXT

export const MAX_WORKERS = 3
export const REPORT_CHARS = 4_000
const LISTED_PATHS = 20
const KEEP_DELIVERED_MS = 7 * 86_400_000
export const MAX_WORKER_RESUMES = 3
export const MAX_WORKER_STEPS = 60
const GAVE_UP = "it stopped after repeated restarts."

export type WorkStatus = "pending" | "running" | "done" | "failed" | "stopped"

export type StepTaken = "talker" | "worker" | "spent"

type WorkEvent = "submit" | "done" | "lose" | "stop"

const TRANSITIONS: Readonly<Record<WorkStatus, Partial<Record<WorkEvent, WorkStatus>>>> = {
  pending: { submit: "running", stop: "stopped", lose: "failed" },
  running: { done: "done", lose: "failed", stop: "stopped" },
  done: { submit: "running" },
  failed: { submit: "running" },
  stopped: { submit: "running" },
}

export const transition = (from: WorkStatus, event: WorkEvent): WorkStatus => TRANSITIONS[from][event] ?? from

export const ended = (status: WorkStatus): boolean => status === "done" || status === "failed" || status === "stopped"

export type Work = {
  id: string
  task: string
  conversationId: ConversationId | null
  submissionId: SubmissionId | null
  status: WorkStatus
  step: string | null
  steps: number
  delivered: boolean
  runId: string | null
  startedAt: number
  updatedAt: number
}

type Row = {
  id: string
  task: string
  conversation_id: number | null
  submission_id: number | null
  status: WorkStatus
  step: string | null
  steps: number
  delivered: number
  run_id: string | null
  started_at: number
  updated_at: number
}

type Progress = { step: string; steps: number }

const toWork = (r: Row, progress: Progress | undefined): Work => ({
  id: r.id,
  task: r.task,
  conversationId: r.conversation_id as ConversationId | null,
  submissionId: r.submission_id as SubmissionId | null,
  status: r.status,
  step: progress?.step ?? r.step,
  steps: progress?.steps ?? r.steps,
  delivered: r.delivered === 1,
  runId: r.run_id,
  startedAt: r.started_at,
  updatedAt: r.updated_at,
})

export type WorkersOptions = {
  deliver: (envelope: Envelope) => Promise<unknown>
  onChange?: (running: number) => void
  now?: () => number
  agentKey: string
}

export const INITIAL_WORKERS_STEPS: Step[] = [
  `CREATE TABLE IF NOT EXISTS workers (
    agent TEXT NOT NULL, n INTEGER NOT NULL, id TEXT NOT NULL, task_id TEXT NOT NULL,
    task TEXT NOT NULL, conversation_id INTEGER, submission_id INTEGER, status TEXT NOT NULL,
    step TEXT, steps INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resumes INTEGER NOT NULL DEFAULT 0,
    run_id TEXT, PRIMARY KEY (agent, n), UNIQUE (agent, id), UNIQUE (agent, task_id)
  ) WITHOUT ROWID, STRICT`,
  `CREATE TABLE IF NOT EXISTS worker_changes (
    agent TEXT NOT NULL, work_id TEXT NOT NULL, path TEXT NOT NULL, n INTEGER NOT NULL,
    PRIMARY KEY (agent, work_id, path)
  ) WITHOUT ROWID, STRICT`,
]

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function listed({ paths, more }: { paths: readonly string[]; more: number }): string {
  if (!paths.length) return "no files"
  return more > 0 ? `${paths.join(", ")} and ${more} more` : paths.join(", ")
}

export class Workers {
  private readonly sql: SqlStorage
  private readonly now: () => number
  private readonly agent: string
  private readonly progress = new Map<string, Progress>()
  private harness?: Harness

  constructor(
    storage: DurableObjectStorage,
    private readonly options: WorkersOptions,
  ) {
    this.sql = storage.sql
    this.agent = options.agentKey
    this.now = options.now ?? Date.now
  }

  list(): Work[] {
    return this.sql
      .exec<Row>("SELECT * FROM workers WHERE agent = ? ORDER BY n", this.agent)
      .toArray()
      .map((r) => this.toWork(r))
  }

  private toWork(r: Row): Work {
    return toWork(r, this.progress.get(r.id))
  }

  get(id: string): Work | null {
    const row = this.sql.exec<Row>("SELECT * FROM workers WHERE id = ? AND agent = ?", id, this.agent).toArray()[0]
    return row ? this.toWork(row) : null
  }

  byTask(taskId: string): Work | null {
    const row = this.sql
      .exec<Row>("SELECT * FROM workers WHERE task_id = ? AND agent = ?", taskId, this.agent)
      .toArray()[0]
    return row ? this.toWork(row) : null
  }

  running(): Work[] {
    return this.list().filter((w) => w.status === "running")
  }

  live(): Work[] {
    return this.list().filter((w) => !ended(w.status))
  }

  byConversation(conversationId: ConversationId): Work | null {
    const row = this.sql
      .exec<Row>("SELECT * FROM workers WHERE conversation_id = ? AND agent = ?", conversationId, this.agent)
      .toArray()[0]
    return row ? this.toWork(row) : null
  }

  reserve(taskId: string, task: string, runId: string | null = null): Work | null {
    if (this.live().length >= MAX_WORKERS) return null
    const now = this.now()
    this.sql.exec(
      "DELETE FROM workers WHERE delivered = 1 AND updated_at < ? AND n < (SELECT max(n) FROM workers WHERE agent = ?) AND agent = ?",
      now - KEEP_DELIVERED_MS,
      this.agent,
      this.agent,
    )
    this.sql.exec(
      "DELETE FROM worker_changes WHERE agent = ? AND work_id NOT IN (SELECT id FROM workers WHERE agent = ?)",
      this.agent,
      this.agent,
    )
    const n = this.sql
      .exec<{ n: number }>("SELECT coalesce(max(n), 0) + 1 AS n FROM workers WHERE agent = ?", this.agent)
      .one().n
    this.sql.exec(
      "INSERT INTO workers (agent, n, id, task_id, task, status, run_id, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      this.agent,
      n,
      `w${n}`,
      taskId,
      task,
      "pending" satisfies WorkStatus,
      runId,
      now,
      now,
    )
    this.changed()
    return this.get(`w${n}`)
  }

  placed(id: string, conversationId: ConversationId): void {
    const work = this.get(id)
    if (!work) return
    this.sql.exec(
      "UPDATE workers SET conversation_id = ?, status = ?, updated_at = ? WHERE id = ? AND agent = ?",
      conversationId,
      work.status === "pending" ? transition(work.status, "submit") : work.status,
      this.now(),
      id,
      this.agent,
    )
    if (work.status === "pending") this.changed()
  }

  follow(id: string, submissionId: SubmissionId): void {
    const work = this.get(id)
    if (!work || work.submissionId === submissionId) return
    if (work.status !== "running") this.progress.delete(id)
    this.sql.exec(
      "UPDATE workers SET submission_id = ?, status = ?, delivered = 0, updated_at = ? WHERE id = ? AND agent = ?",
      submissionId,
      transition(work.status, "submit"),
      this.now(),
      id,
      this.agent,
    )
    this.changed()
  }

  step(conversationId: ConversationId, step: string): StepTaken {
    const row = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM workers WHERE conversation_id = ? AND status = 'running' AND agent = ?",
        conversationId,
        this.agent,
      )
      .toArray()[0]
    if (!row) return "talker"
    const steps = this.progress.get(row.id)?.steps ?? 0
    if (steps >= MAX_WORKER_STEPS) return "spent"
    this.progress.set(row.id, { step, steps: steps + 1 })
    return "worker"
  }

  touched(conversationId: ConversationId, paths: readonly string[]): void {
    if (!paths.length) return
    const row = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM workers WHERE conversation_id = ? AND agent = ?",
        conversationId,
        this.agent,
      )
      .toArray()[0]
    if (!row) return
    this.sql.exec(
      "INSERT OR IGNORE INTO worker_changes (agent, work_id, path, n) SELECT ?, ?, value, (SELECT coalesce(max(n), 0) FROM worker_changes WHERE agent = ? AND work_id = ?) + CAST(key AS INTEGER) + 1 FROM json_each(?)",
      this.agent,
      row.id,
      this.agent,
      row.id,
      JSON.stringify(paths),
    )
  }

  changedPaths(id: string): { paths: string[]; more: number } {
    const paths = this.sql
      .exec<{ path: string }>(
        "SELECT path FROM worker_changes WHERE work_id = ? AND agent = ? ORDER BY n, path LIMIT ?",
        id,
        this.agent,
        LISTED_PATHS,
      )
      .toArray()
    const total = this.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM worker_changes WHERE work_id = ? AND agent = ?", id, this.agent)
      .one().n
    return { paths: paths.map((r) => r.path), more: total - paths.length }
  }

  async stop(id: string): Promise<Work | null> {
    const work = this.get(id)
    if (!work || ended(work.status)) return work
    const next = transition(work.status, "stop")
    this.sql.exec(
      "UPDATE workers SET status = ?, updated_at = ? WHERE id = ? AND agent = ?",
      next,
      this.now(),
      id,
      this.agent,
    )
    this.changed()
    void this.abort(work)
    return this.get(id)
  }

  async stopAll({ deferAbort = false }: { deferAbort?: boolean } = {}): Promise<void> {
    const live = this.live()
    if (!live.length) return
    this.sql.exec(
      "UPDATE workers SET status = 'stopped', delivered = 1, updated_at = ? WHERE status IN ('pending', 'running') AND agent = ?",
      this.now(),
      this.agent,
    )
    this.changed()
    if (!deferAbort) await Promise.all(live.map((work) => this.abort(work)))
  }

  forget(): void {
    this.sql.exec(
      "UPDATE workers SET status = CASE WHEN status IN ('pending', 'running') THEN 'failed' ELSE status END, delivered = 1, task_id = 'gone:' || id, conversation_id = NULL, submission_id = NULL, updated_at = ? WHERE task_id NOT LIKE 'gone:%' AND agent = ?",
      this.now(),
      this.agent,
    )
    this.changed()
  }

  async invalidate(harness: Harness): Promise<void> {
    const previous = this.list()
    this.forget()
    this.sql.exec("UPDATE workers SET task = '', step = NULL WHERE agent = ?", this.agent)
    this.progress.clear()
    this.sql.exec("DELETE FROM worker_changes WHERE agent = ?", this.agent)
    await Promise.all(
      previous.map(async (work) => {
        if (work.conversationId === null) return
        const conversation = await harness.conversation(work.conversationId, context)
        await conversation?.abort(context)
        await conversation?.reset(undefined, context)
      }),
    )
  }

  rearm(harness: Harness): void {
    this.harness = harness
    this.changed()
  }

  async resumed(harness: Harness): Promise<void> {
    const running = this.running().filter(
      (w): w is Work & { conversationId: NonNullable<Work["conversationId"]> } => w.conversationId !== null,
    )
    if (!running.length) return
    const live = new Set((await harness.inspect(context)).tasks.map((t) => t.record.conversationId))
    for (const work of running) {
      if (!live.has(work.conversationId)) continue
      const resumes = this.sql
        .exec<{ resumes: number }>(
          "UPDATE workers SET resumes = resumes + 1 WHERE id = ? AND agent = ? RETURNING resumes",
          work.id,
          this.agent,
        )
        .one().resumes
      if (resumes <= MAX_WORKER_RESUMES) continue
      console.error(`worker ${work.id} stopped after ${MAX_WORKER_RESUMES} resumes that never finished`)
      this.sql.exec(
        "UPDATE workers SET status = 'failed', updated_at = ? WHERE id = ? AND agent = ?",
        this.now(),
        work.id,
        this.agent,
      )
      this.changed()
      this.abort(work)
    }
  }

  note(): string | undefined {
    const live = this.list().filter((w) => !w.delivered && w.conversationId)
    if (!live.length) return undefined
    const lines = live.map(
      (w) =>
        `- ${w.id} (${w.status}, ${w.steps} ${w.steps === 1 ? "step" : "steps"}): ${clip(w.task, 160)}. changed: ${listed(this.changedPaths(w.id))}.${w.step ? ` last step: ${clip(w.step, 100)}` : ""}`,
    )
    return `your workers:\n${lines.join("\n")}`
  }

  private changed(): void {
    this.options.onChange?.(this.running().length)
  }

  private async abort(work: Work): Promise<void> {
    const harness = this.harness
    if (!harness || !work.conversationId) return
    try {
      const conversation = await harness.conversation(work.conversationId, context)
      await conversation?.abort(context)
    } catch (error) {
      console.error(`worker ${work.id} abort failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async complete(id: string, submissionId: SubmissionId, settled: SettledSubmissionRecord): Promise<void> {
    const harness = this.harness
    if (!harness) throw new WorkerMissing({ message: "worker harness not attached" })
    const work = this.get(id)
    if (harness !== this.harness || !work || work.delivered || !work.conversationId) return
    if (work.submissionId !== submissionId) return
    const newer = (await harness.inspect(context)).submissions.findLast((s) => s.conversationId === work.conversationId)
    if (harness !== this.harness) return
    if (newer) {
      this.sql.exec(
        "UPDATE workers SET submission_id = ? WHERE id = ? AND submission_id = ? AND agent = ?",
        newer.id,
        id,
        submissionId,
        this.agent,
      )
      return
    }
    const marked = this.get(id)?.status
    const status: WorkStatus =
      marked === "stopped" || marked === "failed"
        ? marked
        : settled?.status === "done"
          ? transition("running", "done")
          : transition("running", "lose")
    if (status === "stopped" && !this.changedPaths(id).paths.length) {
      this.sql.exec(
        "UPDATE workers SET status = 'stopped', delivered = 1, resumes = 0, updated_at = ? WHERE id = ? AND submission_id = ? AND agent = ?",
        this.now(),
        id,
        submissionId,
        this.agent,
      )
      return this.changed()
    }
    const report = marked === "failed" ? GAVE_UP : await this.report(harness, work.conversationId, status, settled)
    const now = this.get(id)
    if (harness !== this.harness || !now || now.delivered || now.submissionId !== submissionId) return
    this.sql.exec(
      "UPDATE workers SET status = ?, updated_at = ? WHERE id = ? AND agent = ?",
      status,
      this.now(),
      id,
      this.agent,
    )
    const text = status === "done" ? report : `${report} changed: ${listed(this.changedPaths(id))}.`
    await this.options.deliver(workEnvelope(now, submissionId, status, text))
    this.sql.exec(
      "UPDATE workers SET delivered = 1, resumes = 0 WHERE id = ? AND submission_id = ? AND agent = ?",
      id,
      submissionId,
      this.agent,
    )
    if (now.status === "running") this.changed()
  }

  private async report(
    harness: Harness,
    conversationId: ConversationId,
    status: WorkStatus,
    settled: SettledSubmissionRecord | undefined,
  ): Promise<string> {
    if (status === "stopped") return "stopped before it finished."
    if (!settled) return "the work was lost."
    if (settled.type !== "input" || settled.status !== "done")
      return `it failed: ${settled.status === "unanswered" ? settled.reason : "no answer"}.`
    const conversation = await harness.conversation(conversationId, context)
    const entry = await conversation?.commit((tx) => tx.entry(AssistantEntry, settled.answer), context)
    const message = entry?.model?.[0] as AssistantMessage | undefined
    const text = plainReport((message?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join(""))
    return clip(text || "it finished with no report.", REPORT_CHARS)
  }
}

export function plainReport(text: string): string {
  return text.replace(/<harness>[\s\S]*?(?:<\/harness>|$)/g, "").trim()
}

export function workEnvelope(
  work: Pick<Work, "id">,
  submissionId: SubmissionId,
  status: WorkStatus,
  report: string,
): Envelope {
  return {
    id: `work:${work.id}:${submissionId}`,
    from: { kind: "system", reason: "work" },
    body: report,
    hop: 0,
    rootId: `work:${work.id}`,
    seq: 0,
    work: { id: work.id, status },
  }
}
