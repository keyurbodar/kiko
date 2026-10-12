import type { Actor, AgentSlug, RoomEvent, Task, TaskOp, TaskStatus } from "@yuki/protocol"
import { actorKey, type RoomLog } from "./log"
import type { Chain } from "./mail"

export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "blocked", "review", "done", "cancelled"]
const CLOSED: ReadonlySet<TaskStatus> = new Set(["done", "cancelled"])

export const MAX_TASKS = 200
const MAX_TITLE = 200
const MAX_NOTE = 2_000
const MAX_DEPS = 20

export type WorkspaceCall =
	| { op: "update_task"; id: string; status?: string; note?: string }
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
	create(by: Actor, input: { id: string; title: string; owner?: string | null; dependsOn?: readonly string[] }, members: readonly AgentSlug[], chain?: Chain): Result<Task>
	update(by: Actor, id: string, patch: { title?: string; status?: string; owner?: string | null; note?: string }, members: readonly AgentSlug[], lead: boolean): Result<Task>
	claim(slug: AgentSlug, id: string): Result<Task>
	remove(id: string): Result<null>
	pendingWakes(): Wake[]
	markWoken(taskId: string): void
	chainOf(id: string): Chain | null
}

export function listTasks(storage: DurableObjectStorage): Task[] {
	return readTasks(storage.sql)
}

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

export const wakeBody = (wake: Pick<Wake, "taskId" | "title">) => `task ${wake.taskId} "${wake.title}" is unblocked: everything it depends on is done. start it now.`

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

	private openDeps(id: string): string[] {
		return this.sql
			.exec<{ id: string }>(
				"SELECT d.depends_on AS id FROM ws_task_deps d JOIN ws_tasks t ON t.id = d.depends_on WHERE d.task_id = ? AND t.status != 'done'",
				id,
			)
			.toArray()
			.map((r) => r.id)
	}

	private emit(by: Actor, task: Task): RoomEvent {
		return this.log.append(actorKey(by), { t: "task", task })
	}

	create(by: Actor, input: { id: string; title: string; owner?: string | null; dependsOn?: readonly string[] }, members: readonly AgentSlug[], chain?: Chain): Result<Task> {
		return this.storage.transactionSync(() => {
			const title = clip(input.title, MAX_TITLE)
			if (!title) return fail("a task needs a title")
			const before = this.task(input.id)
			if (before) return before.title === title ? { ok: true as const, value: before, events: [] } : fail(`task ${input.id} already exists`)
			if (this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM ws_tasks").one().n >= MAX_TASKS) return fail(`the board is full (${MAX_TASKS} tasks)`)
			const owner = input.owner || null
			if (owner && !members.includes(owner as AgentSlug)) return fail(`@${owner} is not a member of this room`)
			const deps = [...new Set(input.dependsOn ?? [])]
			if (deps.length > MAX_DEPS) return fail(`a task can depend on at most ${MAX_DEPS} tasks`)
			if (deps.includes(input.id)) return fail(`task ${input.id} cannot depend on itself`)
			const missing = deps.filter((d) => !this.task(d))
			if (missing.length) return fail(`no task ${missing.join(", ")}`)
			const seq = this.log.lastSeq() + 1
			const made = chain ?? (by.kind === "human" ? { rootId: `task:${input.id}`, hop: 0 } : null)
			this.sql.exec(
				"INSERT INTO ws_tasks (id, title, status, owner, note, created_by, created_seq, updated_at, chain) VALUES (?, ?, 'todo', ?, NULL, ?, ?, ?, ?)",
				input.id,
				title,
				owner,
				actorKey(by),
				seq,
				this.now(),
				made ? JSON.stringify(made) : null,
			)
			for (const d of deps) this.sql.exec("INSERT INTO ws_task_deps (task_id, depends_on) VALUES (?, ?)", input.id, d)
			const task = this.task(input.id)
			if (!task) throw new Error(`task ${input.id} missing after insert`)
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
			if (by.kind === "agent" && !lead && current.owner !== by.slug) {
				return fail(current.owner ? `task ${id} is owned by @${current.owner}` : `task ${id} has no owner. set it to doing to take it`)
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
			const emitted = this.emit(by, next)
			const events = [emitted]
			if (status === "done" && current.status !== "done") this.markUnblocked(id, emitted.seq)
			return { ok: true as const, value: next, events }
		})
	}

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
			const status: TaskStatus = open.length ? current.status : current.status === "todo" || current.status === "blocked" ? "doing" : current.status
			if (current.owner === slug && status === current.status) return { ok: true as const, value: current, events: [] }
			this.sql.exec("UPDATE ws_tasks SET owner = ?, status = ?, updated_at = ? WHERE id = ?", slug, status, this.now(), id)
			const next: Task = { ...current, owner: slug, status }
			const event = this.emit({ kind: "agent", slug }, next)
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

	pendingWakes(): Wake[] {
		return this.sql
			.exec<{ id: string; owner: string; title: string; seq: number; chain: string | null }>(
				`SELECT id, owner, title, unblocked_seq AS seq, chain FROM ws_tasks
				 WHERE unblocked_seq IS NOT NULL AND woken_at IS NULL AND owner IS NOT NULL AND status NOT IN ('done', 'cancelled')
				 ORDER BY unblocked_seq, id`,
			)
			.toArray()
			.map((r) => ({ taskId: r.id, owner: r.owner as AgentSlug, title: r.title, seq: r.seq, chain: r.chain ? (JSON.parse(r.chain) as Chain) : null }))
	}

	chainOf(id: string): Chain | null {
		const raw = this.sql.exec<{ chain: string | null }>("SELECT chain FROM ws_tasks WHERE id = ?", id).toArray()[0]?.chain
		return raw ? (JSON.parse(raw) as Chain) : null
	}

	markWoken(taskId: string): void {
		this.sql.exec("UPDATE ws_tasks SET woken_at = ? WHERE id = ? AND woken_at IS NULL", this.now(), taskId)
	}
}

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

export function runCall(ws: Workspace, slug: AgentSlug, lead: boolean, call: WorkspaceCall, members: readonly AgentSlug[], chain?: Chain): { answer: WorkspaceAnswer; events: RoomEvent[] } {
	const by: Actor = { kind: "agent", slug }
	const done = <T>(r: Result<T>, text: (v: T) => string) =>
		r.ok ? { answer: { ok: true as const, text: text(r.value) }, events: r.events } : { answer: fail(r.error), events: [] }
	switch (call.op) {
		case "update_task": {
			const current = ws.task(call.id)
			if (current && !current.owner && !lead && (call.status === undefined || call.status === "doing")) {
				const claimed = ws.claim(slug, call.id)
				if (!claimed.ok || call.note === undefined) return done(claimed, (t) => `took ${line(t)}`)
			}
			return done(ws.update(by, call.id, { status: call.status, note: call.note }, members, lead), (t) => `updated ${line(t)}`)
		}
		case "create_task":
			if (!lead) return { answer: fail("only the lead creates tasks"), events: [] }
			return done(ws.create(by, call, members, chain), (t) => `created ${line(t)}`)
	}
}
