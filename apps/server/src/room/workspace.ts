import type { Actor, AgentSlug, RoomEvent, Task, TaskOp, TaskStatus } from "@kiko/protocol"
import type { RoomLog } from "./log"
import { actorKey } from "./actor-key"
import type { Chain } from "./messaging"
import { TASK_TITLE_WORD_LIMIT } from "./task-title"

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "blocked", "review", "done", "cancelled"]
const CLOSED: ReadonlySet<TaskStatus> = new Set(["done", "cancelled"])

const MAX_TASKS = 200
const MAX_TITLE = 200
const MAX_NOTE = 2_000
const MAX_DEPS = 20

export type WorkspaceCall =
  | { op: "update_task"; id: string; status?: string; note?: string; title?: string; owner?: string }
  | { op: "create_task"; id: string; title: string; owner?: string; dependsOn?: readonly string[] }

export type WorkspaceAnswer = { ok: true; text: string } | { ok: false; error: string }

type Result<T> = { ok: true; value: T; events: RoomEvent[] } | { ok: false; error: string }

export type Wake = { taskId: string; owner: AgentSlug; title: string; seq: number; chain: Chain | null }

type TaskRow = { id: string; title: string; status: string; owner: string | null; note: string | null }

const clip = (text: string | undefined, max: number) => (text ?? "").trim().slice(0, max)
const isStatus = (s: string): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s)
const fail = (error: string) => ({ ok: false as const, error })

export interface Workspace {
  tasks(): Task[]
  task(id: string): Task | null
  briefTasks(slug: AgentSlug): Task[]
  create(
    by: Actor,
    input: { id: string; title: string; owner?: string | null; dependsOn?: readonly string[] },
    members: readonly AgentSlug[],
    chain?: Chain,
  ): Result<Task>
  update(
    by: Actor,
    id: string,
    patch: { title?: string; status?: string; owner?: string | null; note?: string },
    members: readonly AgentSlug[],
    lead: boolean,
  ): Result<Task>
  remove(id: string): Result<null>
  pendingWakes(): Wake[]
  markWoken(taskId: string): void
  chainOf(id: string): Chain | null
}

export function listTasks(storage: DurableObjectStorage, roomId: string): Task[] {
  return readTasks(storage.sql, roomId)
}

export function briefTasks(sql: SqlStorage, slug: AgentSlug, roomId: string, lead = false): Task[] {
  const tasks = readTasks(sql, roomId)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const mine = tasks.filter((t) => (lead || t.owner === slug) && !CLOSED.has(t.status))
  const ids = new Set(mine.map((t) => t.id))
  const blockers: Task[] = []
  for (const id of mine.flatMap((t) => t.dependsOn)) {
    const t = byId.get(id)
    if (!t || ids.has(id) || CLOSED.has(t.status)) continue
    ids.add(id)
    blockers.push(t)
  }
  return [...mine, ...blockers]
}

function toTask(r: TaskRow, dependsOn: string[]): Task {
  return {
    id: r.id,
    title: r.title,
    status: r.status as TaskStatus,
    ...(r.owner ? { owner: r.owner as AgentSlug } : {}),
    dependsOn,
    ...(r.note ? { note: r.note } : {}),
  }
}

function readTasks(sql: SqlStorage, roomId: string): Task[] {
  const exists = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ws_tasks'").toArray().length > 0
  if (!exists) return []
  const deps = new Map<string, string[]>()
  for (const r of sql
    .exec<{ t: string; d: string }>(
      "SELECT task_id AS t, depends_on AS d FROM ws_task_deps WHERE ws_task_deps.room_id = ?1 ORDER BY rowid",
      roomId,
    )
    .toArray()) {
    deps.set(r.t, [...(deps.get(r.t) ?? []), r.d])
  }
  return sql
    .exec<TaskRow>(
      "SELECT id, title, status, owner, note FROM ws_tasks WHERE ws_tasks.room_id = ?1 ORDER BY created_seq, id",
      roomId,
    )
    .toArray()
    .map((r) => toTask(r, deps.get(r.id) ?? []))
}

export const wakeBody = (wake: Pick<Wake, "taskId" | "title">) =>
  `task ${wake.taskId} "${wake.title}" is unblocked: everything it depends on is done. start it now.`

export class RoomWorkspace implements Workspace {
  private readonly sql: SqlStorage

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly log: RoomLog,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = storage.sql
  }

  private resolveAssignment(
    by: Actor,
    id: string,
    patch: Parameters<Workspace["update"]>[2],
    members: readonly AgentSlug[],
    lead: boolean,
    current: Task,
  ): { owner: string | null; status: TaskStatus } | ReturnType<typeof fail> {
    const asked = patch.owner === undefined ? undefined : patch.owner || null
    let owner = asked === undefined ? (current.owner ?? null) : asked
    const taking = owner !== null && owner !== current.owner
    if (by.kind === "agent" && !lead && taking && owner !== by.slug)
      return fail(`task ${id} can only be assigned to @${by.slug}`)
    if (by.kind === "agent" && !lead && current.owner && current.owner !== by.slug)
      return fail(`task ${id} is owned by @${current.owner}`)
    if (taking && CLOSED.has(current.status)) return fail(`task ${id} is ${current.status}`)
    if (asked === undefined && !owner && by.kind === "agent" && patch.status === "doing") owner = by.slug
    if (owner && owner !== current.owner && !members.includes(owner as AgentSlug))
      return fail(`@${owner} is not a member of this room`)
    if (by.kind === "agent" && !owner && asked === undefined)
      return fail(`task ${id} has no owner. set it to doing to take it`)
    const starts =
      patch.status === undefined &&
      taking &&
      !current.owner &&
      (current.status === "todo" || current.status === "blocked") &&
      !this.openDeps(id).length
    const status = (patch.status as TaskStatus | undefined) ?? (starts ? "doing" : current.status)
    if (status === "done" && current.status !== "done") {
      const open = this.openDeps(id)
      if (open.length) return fail(`task ${id} waits on ${open.join(", ")}, which are not done`)
    }
    return { owner, status }
  }

  private validateDependencies(input: Parameters<Workspace["create"]>[1]): string[] | ReturnType<typeof fail> {
    const deps = [...new Set(input.dependsOn ?? [])]
    if (deps.length > MAX_DEPS) return fail(`a task can depend on at most ${MAX_DEPS} tasks`)
    if (deps.includes(input.id)) return fail(`task ${input.id} cannot depend on itself`)
    const missing = deps.filter((d) => !this.task(d))
    if (missing.length) return fail(`no task ${missing.join(", ")}`)
    return deps
  }

  private deps(id: string): string[] {
    return this.sql
      .exec<{ d: string }>(
        "SELECT depends_on AS d FROM ws_task_deps WHERE task_id = ?1 AND ws_task_deps.room_id = ?2 ORDER BY rowid",
        id,
        this.log.roomId,
      )
      .toArray()
      .map((r) => r.d)
  }

  tasks(): Task[] {
    return readTasks(this.sql, this.log.roomId)
  }

  task(id: string): Task | null {
    const row = this.sql
      .exec<TaskRow>(
        "SELECT id, title, status, owner, note FROM ws_tasks WHERE id = ?1 AND ws_tasks.room_id = ?2",
        id,
        this.log.roomId,
      )
      .toArray()[0]
    return row ? toTask(row, this.deps(id)) : null
  }

  briefTasks(slug: AgentSlug): Task[] {
    return briefTasks(this.sql, slug, this.log.roomId)
  }

  private openDeps(id: string): string[] {
    return this.sql
      .exec<{ id: string }>(
        "SELECT d.depends_on AS id FROM ws_task_deps AS d JOIN ws_tasks AS t ON t.id = d.depends_on WHERE ((d.task_id = ?1 AND t.status <> 'done') AND d.room_id = ?2) AND t.room_id = ?2",
        id,
        this.log.roomId,
      )
      .toArray()
      .map((r) => r.id)
  }

  private emit(by: Actor, task: Task): RoomEvent {
    return this.log.append(actorKey(by), { t: "task", task })
  }

  create(
    by: Actor,
    input: { id: string; title: string; owner?: string | null; dependsOn?: readonly string[] },
    members: readonly AgentSlug[],
    chain?: Chain,
  ): Result<Task> {
    return this.storage.transactionSync(() => {
      const title = clip(input.title, MAX_TITLE)
      if (!title) return fail("a task needs a title")
      const before = this.task(input.id)
      if (before)
        return before.title === title
          ? { ok: true as const, value: before, events: [] }
          : fail(`task ${input.id} already exists`)
      if (
        this.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM ws_tasks WHERE ws_tasks.room_id = ?1", this.log.roomId)
          .one().n >= MAX_TASKS
      )
        return fail(`the board is full (${MAX_TASKS} tasks)`)
      const owner = input.owner || null
      if (owner && !members.includes(owner as AgentSlug)) return fail(`@${owner} is not a member of this room`)
      const checked = this.validateDependencies(input)
      if (!Array.isArray(checked)) return checked
      const deps = checked
      const seq = this.log.lastSeq() + 1
      const made = chain ?? (by.kind === "human" ? { rootId: `task:${input.id}`, hop: 0 } : null)
      this.sql.exec(
        "INSERT INTO ws_tasks (id, title, status, owner, note, created_by, created_seq, updated_at, chain, room_id) VALUES (?1, ?2, 'todo', ?3, NULL, ?4, ?5, ?6, ?7, ?8)",
        input.id,
        title,
        owner,
        actorKey(by),
        seq,
        this.now(),
        made ? JSON.stringify(made) : null,
        this.log.roomId,
      )
      for (const d of deps)
        this.sql.exec(
          "INSERT INTO ws_task_deps (task_id, depends_on, room_id) VALUES (?1, ?2, ?3)",
          input.id,
          d,
          this.log.roomId,
        )
      const task = this.task(input.id)
      if (!task) throw new Error(`task ${input.id} missing after insert`)
      const event = this.emit(by, task)
      if (owner && by.kind === "agent" && owner !== by.slug && !this.openDeps(input.id).length) {
        this.sql.exec(
          "UPDATE ws_tasks SET unblocked_seq = ?1 WHERE id = ?2 AND ws_tasks.room_id = ?3",
          event.seq,
          input.id,
          this.log.roomId,
        )
      }
      return { ok: true as const, value: task, events: [event] }
    })
  }

  update(
    by: Actor,
    id: string,
    patch: { title?: string; status?: string; owner?: string | null; note?: string },
    members: readonly AgentSlug[],
    lead: boolean,
  ): Result<Task> {
    return this.storage.transactionSync(() => {
      const current = this.task(id)
      if (!current) return fail(`no task ${id}`)
      if (patch.status !== undefined && !isStatus(patch.status))
        return fail(`status must be one of ${TASK_STATUSES.join(", ")}`)
      const assignment = this.resolveAssignment(by, id, patch, members, lead, current)
      if ("ok" in assignment) return assignment
      const { owner, status } = assignment
      const title = patch.title === undefined ? current.title : clip(patch.title, MAX_TITLE) || current.title
      const note = patch.note === undefined ? (current.note ?? null) : clip(patch.note, MAX_NOTE) || null
      const next: Task = {
        ...current,
        title,
        status,
        ...(owner ? { owner: owner as AgentSlug } : {}),
        ...(note ? { note } : {}),
      }
      if (!owner) delete (next as { owner?: AgentSlug }).owner
      if (!note) delete (next as { note?: string }).note
      if (JSON.stringify(next) === JSON.stringify(current)) return { ok: true as const, value: current, events: [] }
      this.sql.exec(
        "UPDATE ws_tasks SET title = ?1, status = ?2, owner = ?3, note = ?4, updated_at = ?5 WHERE id = ?6 AND ws_tasks.room_id = ?7",
        title,
        status,
        owner,
        note,
        this.now(),
        id,
        this.log.roomId,
      )
      const emitted = this.emit(by, next)
      const events = [emitted]
      if (status === "done" && current.status !== "done" && lead) this.markUnblocked(id, emitted.seq)
      return { ok: true as const, value: next, events }
    })
  }

  private markUnblocked(doneId: string, seq: number): void {
    const dependents = this.sql
      .exec<{ id: string }>(
        "SELECT task_id AS id FROM ws_task_deps WHERE depends_on = ?1 AND ws_task_deps.room_id = ?2",
        doneId,
        this.log.roomId,
      )
      .toArray()
    for (const { id } of dependents) {
      const t = this.task(id)
      if (!t || CLOSED.has(t.status) || this.openDeps(id).length) continue
      this.sql.exec(
        "UPDATE ws_tasks SET unblocked_seq = ?1 WHERE (id = ?2 AND unblocked_seq IS NULL) AND ws_tasks.room_id = ?3",
        seq,
        id,
        this.log.roomId,
      )
    }
  }

  remove(id: string): Result<null> {
    return this.storage.transactionSync(() => {
      if (!this.task(id)) return { ok: true as const, value: null, events: [] }
      this.sql.exec("DELETE FROM ws_tasks WHERE id = ?1 AND ws_tasks.room_id = ?2", id, this.log.roomId)
      this.sql.exec(
        "DELETE FROM ws_task_deps WHERE (task_id = ?1 OR depends_on = ?2) AND ws_task_deps.room_id = ?3",
        id,
        id,
        this.log.roomId,
      )
      return { ok: true as const, value: null, events: [this.log.append("human", { t: "task_removed", id })] }
    })
  }

  pendingWakes(): Wake[] {
    return this.sql
      .exec<{ id: string; owner: string; title: string; seq: number; chain: string | null }>(
        "SELECT id, owner, title, unblocked_seq AS seq, chain FROM ws_tasks WHERE (NOT unblocked_seq IS NULL AND woken_at IS NULL AND NOT owner IS NULL AND status IN ('todo', 'blocked')) AND ws_tasks.room_id = ?1 ORDER BY unblocked_seq, id LIMIT 8",
        this.log.roomId,
      )
      .toArray()
      .map((r) => ({
        taskId: r.id,
        owner: r.owner as AgentSlug,
        title: r.title,
        seq: r.seq,
        chain: r.chain ? (JSON.parse(r.chain) as Chain) : null,
      }))
  }

  queueReport(event: Extract<RoomEvent, { t: "task" }>, from: AgentSlug, recipient: AgentSlug): void {
    const task = event.task
    const action =
      task.status === "blocked"
        ? "Resolve the blocker or give specific feedback. Keep it blocked until the obstacle is cleared."
        : task.status === "review"
          ? "Verify the result and files, then mark it done or return specific feedback."
          : "Use the verified result and continue any ready dependent work."
    const body = `Task ${task.id} (${task.title}) from @${from} is ${task.status}.${task.note ? ` Result: ${task.note}` : ""} Check the current board first; a newer update may supersede this report. ${action} Report the outcome to the human when useful. Do not ask the human to manage task statuses.`
    const chain = this.chainOf(task.id)
    this.sql.exec(
      "INSERT OR IGNORE INTO ws_task_reports (seq, recipient, body, chain, room_id) VALUES (?1, ?2, ?3, ?4, ?5)",
      event.seq,
      recipient,
      body,
      chain ? JSON.stringify(chain) : null,
      this.log.roomId,
    )
  }

  pendingReports(): { seq: number; recipient: AgentSlug; body: string; chain: Chain | null }[] {
    return this.sql
      .exec<{ seq: number; recipient: AgentSlug; body: string; chain: string | null }>(
        "SELECT seq, recipient, body, chain FROM ws_task_reports WHERE ws_task_reports.room_id = ?1 ORDER BY seq LIMIT 8",
        this.log.roomId,
      )
      .toArray()
      .map((r) => ({ ...r, chain: r.chain ? (JSON.parse(r.chain) as Chain) : null }))
  }

  markReported(seq: number): void {
    this.sql.exec("DELETE FROM ws_task_reports WHERE seq = ?1 AND ws_task_reports.room_id = ?2", seq, this.log.roomId)
  }

  chainOf(id: string): Chain | null {
    const raw = this.sql
      .exec<{ chain: string | null }>(
        "SELECT chain FROM ws_tasks WHERE id = ?1 AND ws_tasks.room_id = ?2",
        id,
        this.log.roomId,
      )
      .toArray()[0]?.chain
    return raw ? (JSON.parse(raw) as Chain) : null
  }

  markWoken(taskId: string): void {
    this.sql.exec(
      "UPDATE ws_tasks SET woken_at = ?1 WHERE (id = ?2 AND woken_at IS NULL) AND ws_tasks.room_id = ?3",
      this.now(),
      taskId,
      this.log.roomId,
    )
  }
}

export function applyTaskOp(
  ws: Workspace,
  op: TaskOp,
  members: readonly AgentSlug[],
  refused?: (reason: string) => void,
): RoomEvent[] {
  const human: Actor = { kind: "human" }
  const result =
    op.op === "create"
      ? ws.create(human, op, members)
      : op.op === "update"
        ? ws.update(human, op.id, op, members, true)
        : ws.remove(op.id)
  if (!result.ok) refused?.(result.error)
  return result.ok ? result.events : []
}

const line = (t: Task) =>
  `${t.id} [${t.status}] ${t.title}${t.owner ? ` (@${t.owner})` : ""}${t.dependsOn.length ? ` after ${t.dependsOn.join(", ")}` : ""}`

export function runCall(
  ws: Workspace,
  slug: AgentSlug,
  lead: boolean,
  call: WorkspaceCall,
  members: readonly AgentSlug[],
  chain?: Chain,
): { answer: WorkspaceAnswer; events: RoomEvent[] } {
  if (call.title !== undefined && call.title.trim().split(/\s+/u).filter(Boolean).length > TASK_TITLE_WORD_LIMIT) {
    return {
      answer: fail(
        `task titles must use ${TASK_TITLE_WORD_LIMIT} words or fewer. Put instructions in the handoff message or files, then retry with a concise action label.`,
      ),
      events: [],
    }
  }
  const by: Actor = { kind: "agent", slug }
  const done = <T>(r: Result<T>, text: (v: T) => string) =>
    r.ok
      ? { answer: { ok: true as const, text: text(r.value) }, events: r.events }
      : { answer: fail(r.error), events: [] }
  switch (call.op) {
    case "update_task": {
      const owner = call.owner?.replace(/^@/, "").trim().toLowerCase()
      const who = owner === "me" ? slug : owner
      return done(
        ws.update(
          by,
          call.id,
          { status: call.status, note: call.note, title: call.title, ...(who ? { owner: who } : {}) },
          members,
          lead,
        ),
        (t) => `updated ${line(t)}`,
      )
    }
    case "create_task":
      if (!lead) return { answer: fail("only the lead creates tasks"), events: [] }
      return done(ws.create(by, call, members, chain), (t) => `created ${line(t)}`)
  }
}
