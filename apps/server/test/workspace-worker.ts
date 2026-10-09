import type { AgentSlug } from "@yuki/protocol"
import { DurableObject } from "cloudflare:workers"
import { RoomLog } from "../src/room/log"
import { migrate } from "../src/room/schema"
import { RoomWorkspace, runCall, type WorkspaceCall } from "../src/room/workspace"

// The real workspace tables in workerd. `/call/<room>` posts `{ slug, lead, call }` and answers with
// the tool answer, the stored events, and the pending wakes. `/human/<room>` posts a TaskOp.

const MEMBERS = ["bob", "ada", "cy"] as AgentSlug[]

export class WorkspaceDO extends DurableObject {
	private ws: RoomWorkspace
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as never)
		migrate(ctx.storage)
		this.ws = new RoomWorkspace(ctx.storage, new RoomLog(ctx.storage))
	}
	async call(slug: AgentSlug, lead: boolean, call: WorkspaceCall) {
		// Every agent works on the chain of a human message "m-<slug>", one hop in.
		const { answer, events } = runCall(this.ws, slug, lead, call, MEMBERS, { rootId: `m-${slug}`, hop: 1, authority: { origin: "human", grant: [] } })
		return { answer, events, wakes: this.ws.pendingWakes() }
	}
	async human(op: Parameters<RoomWorkspace["update"]>[2] & { id: string; dependsOn?: string[]; title?: string; create?: boolean }) {
		const r = op.create ? this.ws.create({ kind: "human" }, { id: op.id, title: op.title ?? "", dependsOn: op.dependsOn ?? [] }, MEMBERS) : this.ws.update({ kind: "human" }, op.id, op, MEMBERS, true)
		return { ok: r.ok, error: r.ok ? null : r.error, wakes: this.ws.pendingWakes() }
	}
	async woke(taskId: string) {
		this.ws.markWoken(taskId)
		return this.ws.pendingWakes()
	}
	async state() {
		return { tasks: this.ws.tasks(), brief: this.ws.briefTasks("cy" as AgentSlug) }
	}
}

type Env = { WS: DurableObjectNamespace<WorkspaceDO> }

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, room] = new URL(request.url).pathname.split("/")
		const stub = env.WS.get(env.WS.idFromName(room!))
		const body = request.method === "POST" ? ((await request.json()) as Record<string, never>) : {}
		if (kind === "call") return Response.json(await stub.call(body.slug, body.lead, body.call))
		if (kind === "human") return Response.json(await stub.human(body))
		if (kind === "woke") return Response.json(await stub.woke(body.taskId))
		return Response.json(await stub.state())
	},
}
