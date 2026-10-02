import type { Actor, AgentSlug, Envelope, RoomEvent, RoomId, Task, TaskOp, TaskStatus } from "@kiko/protocol"
import { actorKey, type RoomLog } from "./log"

// Architecture sections 4.3, 7.5, and 7.6. The team's task board, activity log, and shared notes.
// The tables carry a `ws_` prefix and every caller goes through `Workspace`, so the workspace can move
// to its own class later with no change to tool code. Each write runs in one transaction with the room
// events it causes and returns them; the caller publishes. Every board change is a `task` or
// `task_removed` event, so the client stays live. Activity and notes are not on the wire yet.
//
// A task that becomes `done` marks each task whose dependencies are now all done as unblocked. The room
// delivers one `task_unblocked` envelope with the id `unblocked:<taskId>` to its owner and records the
// wake, so it happens once (`pendingWakes`, `markWoken`).

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "blocked", "review", "done", "cancelled"]
const CLOSED: ReadonlySet<TaskStatus> = new Set(["done", "cancelled"])

// ASSUMPTION: the limits below. They keep a model from filling the room's storage.
export const MAX_TASKS = 200
const MAX_TITLE = 200
const MAX_NOTE = 2_000
const MAX_NOTE_BODY = 16_000
const MAX_DEPS = 20

export type WorkspaceCall =
	| { op: "claim_task"; id: string }
	| { op: "update_task"; id: string; status?: string; note?: string }
	| { op: "post_update"; id: string; text: string; taskId?: string }
	| { op: "write_note"; title: string; body: string }
	| { op: "create_task"; id: string; title: string; owner?: string; dependsOn?: readonly string[] }

/** What a tool gets back. `text` and `error` are for a model to read. */
export type WorkspaceAnswer = { ok: true; text: string } | { ok: false; error: string }

type Result<T> = { ok: true; value: T; events: RoomEvent[] } | { ok: false; error: string }

export type Note = { title: string; body: string; author: string; at: number }
export type Activity = { id: string; at: number; actor: string; taskId: string | null; text: string }
export type Wake = { taskId: string; owner: AgentSlug; title: string; seq: number }

type TaskRow = { id: string; title: string; status: string; owner: string | null; note: string | null }

const clip = (text: string | undefined, max: number) => (text ?? "").trim().slice(0, max)
const isStatus = (s: string): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s)
const fail = (error: string) => ({ ok: false as const, error })

export interface Workspace {
	tasks(): Task[]
	task(id: string): Task | null
	/** The member's open tasks and the tasks that block them, for the brief (section 7.4). */
	briefTasks(slug: AgentSlug): Task[]
	create(by: Actor, input: { id: string; title: string; owner?: string | null; dependsOn?: readonly string[] }, members: readonly AgentSlug[]): Result<Task>
	update(by: Actor, id: string, patch: { title?: string; status?: string; owner?: string | null; note?: string }, members: readonly AgentSlug[], lead: boolean): Result<Task>
	claim(slug: AgentSlug, id: string): Result<Task>
	remove(id: string): Result<null>
	postUpdate(by: Actor, id: string, text: string, taskId?: string): Result<Activity>
	writeNote(by: Actor, title: string, body: string): Result<Note>
	notes(): Note[]
	activity(limit: number): Activity[]
	pendingWakes(): Wake[]
	markWoken(taskId: string): void
}

/** Every task, oldest first, for a `reset` snapshot. */
export function listTasks(storage: DurableObjectStorage): Task[] {
	return readTasks(storage.sql)
}

/** The member's open tasks and the tasks that block them, for the brief (section 7.4). */
export function briefTasks(sql: SqlStorage, slug: AgentSlug): Task[] {
	const tasks = readTasks(sql)
	const byId = new Map(tasks.map((t) => [t.id, t]))
	const mine = tasks.filter((t) => t.owner === slug && !CLOSED.has(t.status))
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

/** Every task, oldest first. Reads nothing before the table exists. */
function readTasks(sql: SqlStorage): Task[] {
	const exists = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ws_tasks'").toArray().length > 0
	if (!exists) return []
	const deps = new Map<string, string[]>()
	for (const r of sql.exec<{ t: string; d: string }>("SELECT task_id AS t, depends_on AS d FROM ws_task_deps ORDER BY rowid").toArray()) {
		deps.set(r.t, [...(deps.get(r.t) ?? []), r.d])
	}
	return sql
		.exec<TaskRow>("SELECT id, title, status, owner, note FROM ws_tasks ORDER BY created_seq, id")
		.toArray()
		.map((r) => toTask(r, deps.get(r.id) ?? []))
}

const toTask = (r: TaskRow, dependsOn: string[]): Task => ({
	id: r.id,
	title: r.title,
	status: r.status as TaskStatus,
	...(r.owner ? { owner: r.owner as AgentSlug } : {}),
	dependsOn,
	...(r.note ? { note: r.note } : {}),
})

/** The system envelope that wakes a task's owner (section 7.6). Its id is the dedupe key. */
export function wakeEnvelope(roomId: RoomId, wake: Wake): Envelope {
	const id = `unblocked:${wake.taskId}`
	return {
		id,
		roomId,
		from: { kind: "system", reason: "task_unblocked" },
		body: `task ${wake.taskId} "${wake.title}" is unblocked: everything it depends on is done. start it now.`,
		hop: 0,
		rootId: id,
		tainted: false,
		seq: wake.seq,
	}
}

export class RoomWorkspace implements Workspace {
	private readonly sql: SqlStorage

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
	}

	private deps(id: string): string[] {
		return this.sql.exec<{ d: string }>("SELECT depends_on AS d FROM ws_task_deps WHERE task_id = ? ORDER BY rowid", id).toArray().map((r) => r.d)
	}

	tasks(): Task[] {
		return readTasks(this.sql)
	}

	task(id: string): Task | null {
		const row = this.sql.exec<TaskRow>("SELECT id, title, status, owner, note FROM ws_tasks WHERE id = ?", id).toArray()[0]
		return row ? toTask(row, this.deps(id)) : null
	}

	briefTasks(slug: AgentSlug): Task[] {
		return briefTasks(this.sql, slug)
	}

	/** The open dependencies of a task, by id. */
	private openDeps(id: string): string[] {
		return this.sql
			.exec<{ id: string }>(
				"SELECT d.depends_on AS id FROM ws_task_deps d JOIN ws_tasks t ON t.id = d.depends_on WHERE d.task_id = ? AND t.status != 'done'",
				id,
			)
			.toArray()
			.map((r) => r.id)
	}

	/** True when `from` reaches `to` along dependency edges. */
	private reaches(from: string, to: string): boolean {
		const seen = new Set<string>()
		const stack = [from]
		while (stack.length) {
			const at = stack.pop()!
			if (at === to) return true
			if (seen.has(at)) continue
			seen.add(at)
			stack.push(...this.deps(at))
		}
		return false
	}

	private emit(by: Actor, task: Task): RoomEvent {
		return this.log.append(actorKey(by), { t: "task", task })
	}

	private activityRow(by: Actor, id: string, text: string, taskId: string | null): Activity {
		const row = { id, at: this.now(), actor: actorKey(by), taskId, text }
		this.sql.exec("INSERT OR IGNORE INTO ws_activity (id, at, actor, task_id, text) VALUES (?, ?, ?, ?, ?)", row.id, row.at, row.actor, taskId, text)
		return row
	}

	create(by: Actor, input: { id: string; title: string; owner?: string | null; dependsOn?: readonly string[] }, members: readonly AgentSlug[]): Result<Task> {
		return this.storage.transactionSync(() => {
			const title = clip(input.title, MAX_TITLE)
			if (!title) return fail("a task needs a title")
			const before = this.task(input.id)
			// A repeat of the same create (a replayed tool call or a resent frame) stores nothing.
			if (before) return before.title === title ? { ok: true as const, value: before, events: [] } : fail(`task ${input.id} already exists`)
			if (this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM ws_tasks").one().n >= MAX_TASKS) return fail(`the board is full (${MAX_TASKS} tasks)`)
			const owner = input.owner || null
			if (owner && !members.includes(owner as AgentSlug)) return fail(`@${owner} is not a member of this room`)
			const deps = [...new Set(input.dependsOn ?? [])]
			if (deps.length > MAX_DEPS) return fail(`a task can depend on at most ${MAX_DEPS} tasks`)
			if (deps.includes(input.id)) return fail(`task ${input.id} cannot depend on itself`)
			const missing = deps.filter((d) => !this.task(d))
			if (missing.length) return fail(`no task ${missing.join(", ")}`)
			// A new task has no dependents yet, so it closes a cycle only through an id already on the board.
			const cycle = deps.find((d) => this.reaches(d, input.id))
			if (cycle) return fail(`depending on ${cycle} would make a cycle`)
			const seq = this.log.lastSeq() + 1
			this.sql.exec(
				"INSERT INTO ws_tasks (id, title, status, owner, note, created_by, created_seq, updated_at) VALUES (?, ?, 'todo', ?, NULL, ?, ?, ?)",
				input.id,
				title,
				owner,
				actorKey(by),
				seq,
				this.now(),
			)
			for (const d of deps) this.sql.exec("INSERT INTO ws_task_deps (task_id, depends_on) VALUES (?, ?)", input.id, d)
			this.activityRow(by, `create:${input.id}`, `created ${input.id}: ${title}`, input.id)
			const task = this.task(input.id)!
			return { ok: true as const, value: task, events: [this.emit(by, task)] }
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
			// Section 7.6: an agent changes its own tasks. The lead reviews anyone's, and the human outranks both.
			if (by.kind === "agent" && !lead && current.owner !== by.slug) {
				return fail(current.owner ? `task ${id} is owned by @${current.owner}` : `task ${id} has no owner. claim it first`)
			}
			if (patch.status !== undefined && !isStatus(patch.status)) return fail(`status must be one of ${TASK_STATUSES.join(", ")}`)
			const status = (patch.status as TaskStatus | undefined) ?? current.status
			if (status === "done" && current.status !== "done") {
				const open = this.openDeps(id)
				if (open.length) return fail(`task ${id} waits on ${open.join(", ")}, which are not done`)
			}
			const owner = patch.owner === undefined ? (current.owner ?? null) : patch.owner || null
			if (owner && owner !== current.owner && !members.includes(owner as AgentSlug)) return fail(`@${owner} is not a member of this room`)
			const title = patch.title === undefined ? current.title : clip(patch.title, MAX_TITLE) || current.title
			const note = patch.note === undefined ? (current.note ?? null) : clip(patch.note, MAX_NOTE) || null
			const next: Task = { ...current, title, status, ...(owner ? { owner: owner as AgentSlug } : {}), ...(note ? { note } : {}) }
			if (!owner) delete (next as { owner?: AgentSlug }).owner
			if (!note) delete (next as { note?: string }).note
			if (JSON.stringify(next) === JSON.stringify(current)) return { ok: true as const, value: current, events: [] }
			this.sql.exec("UPDATE ws_tasks SET title = ?, status = ?, owner = ?, note = ?, updated_at = ? WHERE id = ?", title, status, owner, note, this.now(), id)
			const events = [this.emit(by, next)]
			if (status !== current.status) {
				this.activityRow(by, `status:${id}:${events[0]!.seq}`, `${id} is ${status}${note && note !== current.note ? `: ${note}` : ""}`, id)
			}
			if (status === "done" && current.status !== "done") this.markUnblocked(id, events[0]!.seq)
			return { ok: true as const, value: next, events }
		})
	}

	/** Marks each open task whose last open dependency was `doneId`. Runs inside the update's transaction. */
	private markUnblocked(doneId: string, seq: number): void {
		const dependents = this.sql.exec<{ id: string }>("SELECT task_id AS id FROM ws_task_deps WHERE depends_on = ?", doneId).toArray()
		for (const { id } of dependents) {
			const t = this.task(id)
			if (!t || CLOSED.has(t.status) || this.openDeps(id).length) continue
			this.sql.exec("UPDATE ws_tasks SET unblocked_seq = ? WHERE id = ? AND unblocked_seq IS NULL", seq, id)
		}
	}

	claim(slug: AgentSlug, id: string): Result<Task> {
		return this.storage.transactionSync(() => {
			const current = this.task(id)
			if (!current) return fail(`no task ${id}`)
			if (current.owner && current.owner !== slug) return fail(`task ${id} is owned by @${current.owner}. ask them or the lead`)
			if (CLOSED.has(current.status)) return fail(`task ${id} is ${current.status}`)
			const open = this.openDeps(id)
			// ASSUMPTION: claiming starts the task unless it still waits on another.
			const status: TaskStatus = open.length ? current.status : current.status === "todo" || current.status === "blocked" ? "doing" : current.status
			if (current.owner === slug && status === current.status) return { ok: true as const, value: current, events: [] }
			this.sql.exec("UPDATE ws_tasks SET owner = ?, status = ?, updated_at = ? WHERE id = ?", slug, status, this.now(), id)
			const next: Task = { ...current, owner: slug, status }
			const event = this.emit({ kind: "agent", slug }, next)
			this.activityRow({ kind: "agent", slug }, `claim:${id}:${event.seq}`, `claimed ${id}`, id)
			return { ok: true as const, value: next, events: [event] }
		})
	}

	remove(id: string): Result<null> {
		return this.storage.transactionSync(() => {
			if (!this.task(id)) return { ok: true as const, value: null, events: [] }
			this.sql.exec("DELETE FROM ws_tasks WHERE id = ?", id)
			this.sql.exec("DELETE FROM ws_task_deps WHERE task_id = ? OR depends_on = ?", id, id)
			return { ok: true as const, value: null, events: [this.log.append("human", { t: "task_removed", id })] }
		})
	}

	postUpdate(by: Actor, id: string, text: string, taskId?: string): Result<Activity> {
		const body = clip(text, MAX_NOTE)
		if (!body) return fail("an update needs text")
		if (taskId && !this.task(taskId)) return fail(`no task ${taskId}`)
		return { ok: true, value: this.activityRow(by, id, body, taskId ?? null), events: [] }
	}

	writeNote(by: Actor, title: string, body: string): Result<Note> {
		const t = clip(title, MAX_TITLE)
		if (!t) return fail("a note needs a title")
		const note = { title: t, body: (body ?? "").slice(0, MAX_NOTE_BODY), author: actorKey(by), at: this.now() }
		// ASSUMPTION: a note is identified by its title, and writing it again replaces the body.
		this.sql.exec(
			"INSERT INTO ws_notes (title, body, author, at) VALUES (?, ?, ?, ?) ON CONFLICT(title) DO UPDATE SET body = excluded.body, author = excluded.author, at = excluded.at",
			note.title,
			note.body,
			note.author,
			note.at,
		)
		return { ok: true, value: note, events: [] }
	}

	notes(): Note[] {
		return this.sql.exec<Note>("SELECT title, body, author, at FROM ws_notes ORDER BY at, title").toArray()
	}

	activity(limit: number): Activity[] {
		return this.sql
			.exec<{ id: string; at: number; actor: string; task_id: string | null; text: string }>("SELECT * FROM ws_activity ORDER BY at DESC, rowid DESC LIMIT ?", limit)
			.toArray()
			.reverse()
			.map((r) => ({ id: r.id, at: r.at, actor: r.actor, taskId: r.task_id, text: r.text }))
	}

	pendingWakes(): Wake[] {
		return this.sql
			.exec<{ id: string; owner: string; title: string; seq: number }>(
				`SELECT id, owner, title, unblocked_seq AS seq FROM ws_tasks
				 WHERE unblocked_seq IS NOT NULL AND woken_at IS NULL AND owner IS NOT NULL AND status NOT IN ('done', 'cancelled')
				 ORDER BY unblocked_seq, id`,
			)
			.toArray()
			.map((r) => ({ taskId: r.id, owner: r.owner as AgentSlug, title: r.title, seq: r.seq }))
	}

	markWoken(taskId: string): void {
		this.sql.exec("UPDATE ws_tasks SET woken_at = ? WHERE id = ? AND woken_at IS NULL", this.now(), taskId)
	}
}

/** A human's `task` frame. The human may change any task. */
export function applyTaskOp(ws: Workspace, op: TaskOp, members: readonly AgentSlug[]): RoomEvent[] {
	const human: Actor = { kind: "human" }
	const result =
		op.op === "create"
			? ws.create(human, op, members)
			: op.op === "update"
				? ws.update(human, op.id, op, members, true)
				: ws.remove(op.id)
	return result.ok ? result.events : []
}

const line = (t: Task) => `${t.id} [${t.status}] ${t.title}${t.owner ? ` (@${t.owner})` : ""}${t.dependsOn.length ? ` after ${t.dependsOn.join(", ")}` : ""}`

/**
 * One agent tool call (section 7.5). `lead` is the caller's member row, read by the room, never by the
 * agent. Returns the answer for the model and the events to publish.
 */
export function runCall(ws: Workspace, slug: AgentSlug, lead: boolean, call: WorkspaceCall, members: readonly AgentSlug[]): { answer: WorkspaceAnswer; events: RoomEvent[] } {
	const by: Actor = { kind: "agent", slug }
	const done = <T>(r: Result<T>, text: (v: T) => string) =>
		r.ok ? { answer: { ok: true as const, text: text(r.value) }, events: r.events } : { answer: fail(r.error), events: [] }
	switch (call.op) {
		case "claim_task":
			return done(ws.claim(slug, call.id), (t) => `claimed ${line(t)}`)
		case "update_task":
			return done(ws.update(by, call.id, { status: call.status, note: call.note }, members, lead), (t) => `updated ${line(t)}`)
		case "post_update":
			return done(ws.postUpdate(by, call.id, call.text, call.taskId), () => "posted")
		case "write_note":
			return done(ws.writeNote(by, call.title, call.body), (n) => `saved note "${n.title}"`)
		case "create_task":
			if (!lead) return { answer: fail("only the lead creates tasks"), events: [] }
			return done(ws.create(by, call, members), (t) => `created ${line(t)}`)
	}
}
