import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import type { AgentSetup } from "@kiko/agent/host"
import type { Envelope } from "@kiko/protocol"
import { AgentDO } from "../src/agent/agent-do"
import { buildAgent } from "../src/agent/factory"
import type { RoomPort } from "../src/agent/outbox"
import { type FilesBackend, RoomFs, roomViews } from "../src/files/room-fs"

// Rows this object reads and writes, per statement and per KV call. A KV call counts one row per key, which
// is how Cloudflare bills it. A statement counts the rows its cursor reports, once the cursor is consumed.
type Tally = { read: number; written: number; calls: number }
const tallies = new Map<string, Tally>()
const open: { label: string; cursor: SqlStorageCursor<Record<string, SqlStorageValue>> }[] = []

function tally(label: string): Tally {
	let t = tallies.get(label)
	if (!t) tallies.set(label, (t = { read: 0, written: 0, calls: 0 }))
	return t
}

function settle(): void {
	for (const { label, cursor } of open.splice(0)) {
		const t = tally(label)
		t.read += cursor.rowsRead
		t.written += cursor.rowsWritten
		t.calls++
	}
}

// The first words of a statement name it: "SELECT id FROM workers WHERE conversation_id".
const headOf = (query: string) => query.replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ")

function patchStorage(ctx: DurableObjectState): void {
	const sql = ctx.storage.sql
	const exec = sql.exec.bind(sql)
	Object.defineProperty(sql, "exec", {
		configurable: true,
		value: (query: string, ...bindings: SqlStorageValue[]) => {
			const cursor = exec(query, ...bindings)
			open.push({ label: `sql ${headOf(query)}`, cursor })
			if (open.length > 10_000) settle()
			return cursor
		},
	})
	const storage = ctx.storage as unknown as Record<string, (...args: unknown[]) => unknown>
	const kv = (name: string, rows: (args: unknown[]) => number) => {
		const fn = storage[name]!.bind(ctx.storage)
		Object.defineProperty(storage, name, {
			configurable: true,
			value: (...args: unknown[]) => {
				const t = tally(`kv ${name}`)
				t.calls++
				const n = rows(args)
				if (name === "put" || name === "delete") t.written += n
				else t.read += n
				return fn(...args)
			},
		})
	}
	const keys = (x: unknown) => (Array.isArray(x) ? x.length : 1)
	kv("get", (a) => keys(a[0]))
	kv("put", (a) => (typeof a[0] === "object" && a[0] !== null ? Object.keys(a[0]).length : 1))
	kv("delete", (a) => keys(a[0]))
	kv("list", () => 0)
}

const FAUX = { provider: "faux", modelId: "faux-1" }

const refused = { ok: false as const, code: "invalid", message: "not in this test" }
const noFiles: FilesBackend = {
	stat: async () => null,
	list: async () => [],
	bytes: async () => null,
	write: async () => refused,
	move: async () => refused,
	remove: async () => refused,
	mkdir: async () => refused,
	commit: async () => ({ ok: true }),
} as unknown as FilesBackend

const human = (body: string, n: number): Envelope => ({
	id: `human:io${n}`,
	roomId: "01J00000000000000000000000" as Envelope["roomId"],
	from: { kind: "human" },
	body,
	hop: 0,
	rootId: `io${n}`,
	seq: n,
})

type Body =
	| { op: "config"; tps: number }
	| { op: "turn"; text: string; n: number }
	| { op: "seed"; rows: number }
	| { op: "outbox" }
	| { op: "reopen" }
	| { op: "prune" }

// The model's speed, read when the harness opens. A long history is built fast; a stream is measured at 50 tokens a second.
let tps = 50

const context = BACKGROUND_CONTEXT

export class T extends AgentDO {
	private posted = 0
	private nextSeq = 1

	constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof AgentDO>[1]) {
		patchStorage(ctx)
		super(ctx, env)
	}

	protected override roomPort(): RoomPort {
		return {
			post: async () => {
				this.posted++
			},
			draft: async () => {},
			status: async () => {},
			workers: async () => {},
			// The real endRun reads the human messages a run answered; keep that read, drop the RPC.
			endRun: async (_runId, inputs = []) => {
				await (this as unknown as { heard(i: readonly never[]): Promise<string[]> }).heard(inputs as never[])
			},
			react: async () => {},
		}
	}

	protected override async setup(): Promise<AgentSetup> {
		const faux = fauxProvider({ tokensPerSecond: tps })
		const models = createModels()
		models.setProvider(faux.provider)
		// "STREAM <chars>" streams a long answer; anything else gets a short one.
		faux.setResponses(
			Array.from({ length: 2000 }, () => (request: { messages: readonly unknown[] }) => {
				const last = (request.messages as { role: string; content?: unknown }[]).findLast((m) => m.role === "user")
				const text = JSON.stringify(last?.content ?? "")
				const stream = /STREAM (\d+)/.exec(text)
				const reply = stream ? "lorem ipsum dolor sit amet ".repeat(Math.ceil(Number(stream[1]) / 27)).slice(0, Number(stream[1])) : "ok"
				return fauxAssistantMessage(reply)
			}),
		)
		const built = buildAgent({ role: "", lead: true, model: FAUX, files: { fs: new RoomFs("io", noFiles), acceptsImages: () => false }, work: this.host.workers })
		return { models, ...built, env: roomViews("io", noFiles), beginRun: async () => true }
	}

	override async fetch(request: Request): Promise<Response> {
		const body = (await request.json()) as Body
		if (body.op === "config") {
			tps = body.tps
			return Response.json(true)
		}
		if (body.op === "outbox") return Response.json(this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM outbox").one().n)
		if (body.op === "reopen") {
			// Drop the host and the outbox the way an eviction does, then open again: the outbox re-reads its open runs.
			const self = this as unknown as { hostInstance?: AgentDO["host"]; outboxInstance?: unknown }
			await self.hostInstance?.shutdown()
			self.hostInstance = undefined
			self.outboxInstance = undefined
			settle()
			tallies.clear()
			await this.host.open()
			settle()
			return Response.json(tallies.size ? [...tallies].map(([label, t]) => ({ label, ...t })) : [])
		}
		if (body.op === "prune") {
			// The inbox prunes at most hourly, when an admit finds its last prune an hour old. Force that admit.
			settle()
			tallies.clear()
			this.ctx.storage.sql.exec("UPDATE inbox_state SET pruned_at = 0 WHERE id = 1")
			this.host.inbox.admit([], "")
			settle()
			return Response.json([...tallies].map(([label, t]) => ({ label, ...t })))
		}
		if (body.op === "seed") {
			// Submitted inbox rows from earlier days: history the inbox keeps for seven days.
			const sql = this.ctx.storage.sql
			const now = Date.now()
			this.ctx.storage.transactionSync(() => {
				for (let i = 0; i < body.rows; i++) {
					sql.exec(
						"INSERT INTO inbox (id, arrival, priority, envelope, brief, request_id, submitted, at) VALUES (?, ?, 2, '{}', '', ?, 1, ?)",
						`seed:${this.nextSeq}`,
						-this.nextSeq,
						`seed-request:${i % 500}`,
						now - 86_400_000 * 2,
					)
					this.nextSeq++
				}
			})
			settle()
			return Response.json(true)
		}
		// One human message, run to its answer and back to idle. Returns the rows it read and wrote.
		settle()
		tallies.clear()
		const posted = this.posted
		await this.receive([human(body.text, body.n)], "")
		await this.alarm()
		const opened = await this.host.open()
		await opened.harness.waitForIdle(context)
		await this.alarm()
		settle()
		const rows = [...tallies].map(([label, t]) => ({ label, ...t }))
		return Response.json({ posted: this.posted - posted, rows })
	}
}

export default {
	async fetch() {
		return new Response("not found", { status: 404 })
	},
}
