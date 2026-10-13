import { DurableObject } from "cloudflare:workers"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { RoomDO as Room } from "../src/room/room-do"

export class RoomDO extends Room {
	async pendingRows(): Promise<number> {
		return this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM pending").one().n
	}
}

export class UserDO extends DurableObject {
	async recordRoom(): Promise<boolean> {
		return true
	}
	async touchChat(): Promise<void> {}
	async chatTasks(): Promise<void> {}
	async chatTyping(): Promise<void> {}
	async captureHuman(): Promise<void> {}
	async getChat(): Promise<null> {
		return null
	}
}

// An agent that records what the room tells it about an ask, and answers whether a tool was waiting.
export class AgentDO extends DurableObject {
	async askAnswered(id: string, text: string): Promise<boolean> {
		const kept = (await this.ctx.storage.get<string[]>("answers")) ?? []
		await this.ctx.storage.put("answers", [...kept, `${id}=${text}`])
		return (await this.ctx.storage.get<boolean>("waiting")) ?? false
	}
	async waiting(value: boolean): Promise<void> {
		await this.ctx.storage.put("waiting", value)
	}
	async answers(): Promise<string[]> {
		return (await this.ctx.storage.get<string[]>("answers")) ?? []
	}
	async humanComing(): Promise<void> {}
	async stop(): Promise<{ discarded: number }> {
		return { discarded: 0 }
	}
	async wake(): Promise<boolean> {
		return false
	}
	async receive(): Promise<{ refused: null }> {
		return { refused: null }
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomDO>; AGENT: DurableObjectNamespace<AgentDO> }

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, roomId, slug, arg] = new URL(request.url).pathname.split("/")
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
		if (kind === "rpc") {
			const args = (await request.json()) as unknown[]
			const call = (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[slug!]
			return Response.json((await call!.call(stub, ...args)) ?? null)
		}
		if (kind === "agent") {
			const agent = env.AGENT.get(env.AGENT.idFromName(`agent:alice:${roomId}:${slug}`))
			if (arg === "answers") return Response.json(await agent.answers())
			await agent.waiting(arg === "1")
			return new Response("ok")
		}
		const headers = new Headers(request.headers)
		headers.set(USER_ID_HEADER, "alice")
		headers.set(ROOM_ID_HEADER, roomId!)
		return stub.fetch(new Request(request, { headers }))
	},
}
