import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { AssistantEntry, type ConversationId, type Harness, type SettledSubmissionRecord, type SubmissionId } from "@earendil-works/pi-durable"
import type { Envelope, Origin } from "./envelope"

const context = BACKGROUND_CONTEXT

// Workers share the human's one API key.
export const MAX_WORKERS = 3
// The inbox refuses an entry over 128 KB.
export const REPORT_CHARS = 16_000
// How many changed paths a note or a report names before it says "and N more".
const LISTED_PATHS = 20
const KEEP_DELIVERED_MS = 7 * 86_400_000
export const MAX_WORKER_RESUMES = 3
const GAVE_UP = "it stopped after repeated restarts."

export type WorkStatus = "running" | "done" | "failed" | "stopped"

export type Work = {
  id: string
  task: string
  conversationId: ConversationId | null
  submissionId: SubmissionId | null
  status: WorkStatus
  step: string | null
  steps: number
  changed: string[]
  delivered: boolean
  origin: Origin
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
  changed: string
  delivered: number
  origin: Origin
  started_at: number
  updated_at: number
}

const toWork = (r: Row): Work => ({
  id: r.id,
  task: r.task,
  conversationId: r.conversation_id as ConversationId | null,
  submissionId: r.submission_id as SubmissionId | null,
  status: r.status,
  step: r.step,
  steps: r.steps,
  changed: JSON.parse(r.changed) as string[],
  delivered: r.delivered === 1,
  origin: r.origin,
  startedAt: r.started_at,
  updatedAt: r.updated_at,
})

export type WorkersOptions = {
  // Must not wait for a run.
  deliver: (envelope: Envelope) => Promise<unknown>
  origin: () => Origin
  onChange?: (running: number) => void
  now?: () => number
}

export class Workers {
  private readonly sql: SqlStorage
  private readonly now: () => number
  private harness?: Harness
  private readonly watching = new Set<string>()

  constructor(
    storage: DurableObjectStorage,
    private readonly options: WorkersOptions,
  ) {
    this.sql = storage.sql
    this.now = options.now ?? Date.now
    this.sql.exec(`CREATE TABLE IF NOT EXISTS workers (
      n INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL UNIQUE,
      task TEXT NOT NULL,
      conversation_id INTEGER,
      submission_id INTEGER,
      status TEXT NOT NULL,
      step TEXT,
      steps INTEGER NOT NULL DEFAULT 0,
      changed TEXT NOT NULL DEFAULT '[]',
      delivered INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resumes INTEGER NOT NULL DEFAULT 0
    ) STRICT`)
  }

  list(): Work[] {
    return this.sql.exec<Row>("SELECT * FROM workers ORDER BY n").toArray().map(toWork)
  }

  get(id: string): Work | null {
    const row = this.sql.exec<Row>("SELECT * FROM workers WHERE id = ?", id).toArray()[0]
    return row ? toWork(row) : null
  }

  byTask(taskId: string): Work | null {
    const row = this.sql.exec<Row>("SELECT * FROM workers WHERE task_id = ?", taskId).toArray()[0]
    return row ? toWork(row) : null
  }

  running(): Work[] {
    return this.list().filter((w) => w.status === "running")
  }

  reserve(taskId: string, task: string): Work | null {
    if (this.running().length >= MAX_WORKERS) return null
    const now = this.now()
    this.sql.exec("DELETE FROM workers WHERE delivered = 1 AND updated_at < ? AND n < (SELECT max(n) FROM workers)", now - KEEP_DELIVERED_MS)
    const n = this.sql.exec<{ n: number }>("SELECT coalesce(max(n), 0) + 1 AS n FROM workers").one().n
    this.sql.exec(
      "INSERT INTO workers (n, id, task_id, task, status, origin, started_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)",
      n,
      `w${n}`,
      taskId,
      task,
      this.options.origin(),
      now,
      now,
    )
    this.changed()
    return this.get(`w${n}`)
  }

  placed(id: string, conversationId: ConversationId): void {
    this.sql.exec("UPDATE workers SET conversation_id = ?, updated_at = ? WHERE id = ?", conversationId, this.now(), id)
  }

  follow(id: string, submissionId: SubmissionId): void {
    const was = this.get(id)?.status
    this.sql.exec("UPDATE workers SET submission_id = ?, status = 'running', delivered = 0, updated_at = ? WHERE id = ?", submissionId, this.now(), id)
    if (was !== "running") this.changed()
    this.watch(id)
  }

  step(conversationId: ConversationId, step: string): boolean {
    const cursor = this.sql.exec("UPDATE workers SET step = ?, steps = steps + 1, updated_at = ? WHERE conversation_id = ? AND status = 'running'", step, this.now(), conversationId)
    cursor.toArray()
    return cursor.rowsWritten > 0
  }

  // A path is kept once, so a replayed tool result adds nothing. Ends with the run, so a write that lands during a stop is kept too.
  touched(conversationId: ConversationId, paths: readonly string[]): void {
    const row = this.sql.exec<{ id: string; changed: string }>("SELECT id, changed FROM workers WHERE conversation_id = ?", conversationId).toArray()[0]
    if (!row) return
    const known = JSON.parse(row.changed) as string[]
    const next = [...new Set([...known, ...paths])]
    if (next.length === known.length) return
    this.sql.exec("UPDATE workers SET changed = ? WHERE id = ?", JSON.stringify(next), row.id)
  }

  stop(id: string): Work | null {
    const work = this.get(id)
    if (work?.status !== "running") return work
    this.sql.exec("UPDATE workers SET status = 'stopped', updated_at = ? WHERE id = ?", this.now(), id)
    this.changed()
    this.abort(work)
    return this.get(id)
  }

  stopAll(): void {
    const running = this.running()
    if (!running.length) return
    this.sql.exec("UPDATE workers SET status = 'stopped', delivered = 1, updated_at = ? WHERE status = 'running'", this.now())
    this.changed()
    for (const work of running) this.abort(work)
  }

  // Their ids start over, so no row may point into them.
  forget(): void {
    this.sql.exec(
      "UPDATE workers SET status = CASE WHEN status = 'running' THEN 'failed' ELSE status END, delivered = 1, task_id = 'gone:' || id, conversation_id = NULL, submission_id = NULL, updated_at = ? WHERE task_id NOT LIKE 'gone:%'",
      this.now(),
    )
    this.changed()
  }

  rearm(harness: Harness): void {
    this.harness = harness
    this.watching.clear()
    for (const work of this.list()) {
      if (work.delivered) continue
      if (work.status === "stopped" || work.status === "failed") this.abort(work)
      this.watch(work.id)
    }
    this.changed()
  }

  async resumed(harness: Harness): Promise<void> {
    const running = this.running().filter((w): w is Work & { conversationId: NonNullable<Work["conversationId"]> } => w.conversationId !== null)
    if (!running.length) return
    const live = new Set((await harness.inspect(context)).tasks.map((t) => t.record.conversationId))
    for (const work of running) {
      if (!live.has(work.conversationId)) continue
      const resumes = this.sql.exec<{ resumes: number }>("UPDATE workers SET resumes = resumes + 1 WHERE id = ? RETURNING resumes", work.id).one().resumes
      if (resumes <= MAX_WORKER_RESUMES) continue
      console.error(`worker ${work.id} stopped after ${MAX_WORKER_RESUMES} resumes that never finished`)
      this.sql.exec("UPDATE workers SET status = 'failed', updated_at = ? WHERE id = ?", this.now(), work.id)
      this.changed()
      this.abort(work)
    }
  }

  note(): string | undefined {
    const live = this.list().filter((w) => !w.delivered && w.conversationId)
    if (!live.length) return undefined
    const lines = live.map((w) => `- ${w.id} (${w.status}, ${w.steps} ${w.steps === 1 ? "step" : "steps"}): ${clip(w.task, 160)}. changed: ${listed(w.changed)}.${w.step ? ` last step: ${clip(w.step, 100)}` : ""}`)
    return `your workers:\n${lines.join("\n")}`
  }

  private changed(): void {
    this.options.onChange?.(this.running().length)
  }

  private abort(work: Work): void {
    const harness = this.harness
    if (!harness || !work.conversationId) return
    void harness
      .conversation(work.conversationId, context)
      .then((c) => c?.abort(context))
      .catch((error: unknown) => console.error(`worker ${work.id} abort failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  private watch(id: string): void {
    const harness = this.harness
    const work = this.get(id)
    if (!harness || !work?.submissionId || work.delivered) return
    const key = `${id}:${work.submissionId}`
    if (this.watching.has(key)) return
    this.watching.add(key)
    void this.settle(harness, id, work.submissionId)
      .catch((error: unknown) => {
        // A closed harness rejects its waits. The next open watches again.
        if (harness === this.harness) console.error(`worker ${id} watch failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => this.watching.delete(key))
  }

  private async settle(harness: Harness, id: string, submissionId: SubmissionId): Promise<void> {
    const submission = await harness.submission(submissionId, context)
    const settled = submission ? await submission.wait(context) : undefined
    const work = this.get(id)
    if (harness !== this.harness || !work || work.delivered || !work.conversationId) return
    if (work.submissionId !== submissionId) return this.watch(id)
    // An input that joined after this one, such as a steer, may still be live.
    const newer = (await harness.inspect(context)).submissions.filter((s) => s.conversationId === work.conversationId).at(-1)
    if (harness !== this.harness) return
    if (newer) {
      this.sql.exec("UPDATE workers SET submission_id = ? WHERE id = ? AND submission_id = ?", newer.id, id, submissionId)
      return this.watch(id)
    }
    const marked = this.get(id)?.status
    const status: WorkStatus = marked === "stopped" || marked === "failed" ? marked : settled?.status === "done" ? "done" : "failed"
    const report = marked === "failed" ? GAVE_UP : await this.report(harness, work.conversationId, status, settled)
    const now = this.get(id)
    if (harness !== this.harness || !now || now.delivered || now.submissionId !== submissionId) return
    this.sql.exec("UPDATE workers SET status = ?, updated_at = ? WHERE id = ?", status, this.now(), id)
    // A done worker's report is its own words. A worker that ended early says what it left behind.
    const text = status === "done" ? report : `${report} changed: ${listed(now.changed)}.`
    await this.options.deliver(workEnvelope(now, submissionId, status, text))
    this.sql.exec("UPDATE workers SET delivered = 1, resumes = 0 WHERE id = ? AND submission_id = ?", id, submissionId)
    // After the report is in the inbox, so the agent does not show idle before the run that tells the human.
    if (now.status === "running") this.changed()
  }

  private async report(harness: Harness, conversationId: ConversationId, status: WorkStatus, settled: SettledSubmissionRecord | undefined): Promise<string> {
    if (status === "stopped") return "stopped before it finished."
    if (!settled) return "the work was lost."
    if (settled.type !== "input" || settled.status !== "done") return `it failed: ${settled.status === "unanswered" ? settled.reason : "no answer"}.`
    const conversation = await harness.conversation(conversationId, context)
    const entry = await conversation?.commit((tx) => tx.entry(AssistantEntry, settled.answer), context)
    const message = entry?.model?.[0] as AssistantMessage | undefined
    const text = (message?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")
    return clip(text.trim() || "it finished with no report.", REPORT_CHARS)
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const listed = (paths: readonly string[]) => {
  if (!paths.length) return "no files"
  const shown = paths.slice(0, LISTED_PATHS).join(", ")
  return paths.length > LISTED_PATHS ? `${shown} and ${paths.length - LISTED_PATHS} more` : shown
}

export function workEnvelope(work: Pick<Work, "id" | "origin">, submissionId: SubmissionId, status: WorkStatus, report: string): Envelope {
  return {
    id: `work:${work.id}:${submissionId}`,
    from: { kind: "system", reason: "work" },
    body: report,
    hop: 0,
    rootId: `work:${work.id}`,
    origin: work.origin,
    seq: 0,
    work: { id: work.id, status },
  }
}
