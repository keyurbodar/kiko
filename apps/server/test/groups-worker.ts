import { DurableObject } from "cloudflare:workers"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { RoomDO as Room } from "../src/room/room-do"

export class RoomDO extends Room {}

const AGENTS = [
	{ id: "a-ada", slug: "ada", name: "Ada", prompt: "Ada\n\nwrites", model: "" },
	{ id: "a-bo", slug: "bo", name: "Bo", prompt: "Bo\n\nchecks", model: "" },
	{ id: "a-di", slug: "di", name: "Di", prompt: "Di\n\ndraws", model: "" },
]

// A user object with a fixed agent list. The Kiko home room is the Kiko chat.
export class UserDO extends DurableObject {
	async recordRoom(): Promise<boolean> {
		return true
	}
	async touchChat(): Promise<void> {}
	async chatTasks(): Promise<void> {}
	async chatTyping(): Promise<void> {}
	async captureHuman(): Promise<void> {}
	async listAgents(): Promise<unknown[]> {
		const made = (await this.ctx.storage.get<unknown[]>("made")) ?? []
		return [...AGENTS, ...made]
	}
	async getChat(roomId: string): Promise<unknown> {
		const chats = (await this.ctx.storage.get<Record<string, unknown>>("chats")) ?? {}
		if (((await this.ctx.storage.get<string[]>("kiko")) ?? []).includes(roomId)) return { roomId, title: "Kiko", agents: ["kiko"], kiko: true }
		return chats[roomId] ?? { roomId, title: "Chat" }
	}
	async makeAgent(input: { name: string; slug: string; description: string }): Promise<unknown> {
		const agent = { id: `a-${input.slug}`, slug: input.slug, name: input.name, prompt: input.description, model: "" }
		await this.ctx.storage.put("made", [...((await this.ctx.storage.get<unknown[]>("made")) ?? []), agent])
		return agent
	}
	async openChat(title: string, agents: string[]): Promise<{ roomId: string; created: boolean }> {
		const chats = (await this.ctx.storage.get<Record<string, { agents: string[]; roomId: string }>>("chats")) ?? {}
		const key = [...agents].sort().join(",")
		const found = Object.values(chats).find((c) => [...c.agents].sort().join(",") === key)
		if (found) return { roomId: found.roomId, created: false }
		const roomId = `01JZ8Q4T6M${String(Object.keys(chats).length + 1).padStart(16, "0")}`
		chats[roomId] = { roomId, title, agents } as never
		await this.ctx.storage.put("chats", chats)
		const opened = (await this.ctx.storage.get<unknown[]>("opened")) ?? []
		await this.ctx.storage.put("opened", [...opened, { title, agents }])
		return { roomId, created: true }
	}
	async chatMembers(roomId: string, slugs: string[]): Promise<void> {
		await this.ctx.storage.put(`members:${roomId}`, [...slugs].sort())
	}
	async savedMembers(roomId: string): Promise<unknown> {
		return (await this.ctx.storage.get(`members:${roomId}`)) ?? null
	}
	async markKiko(roomId: string): Promise<void> {
		await this.ctx.storage.put("kiko", [...((await this.ctx.storage.get<string[]>("kiko")) ?? []), roomId])
	}
	async opened(): Promise<unknown[]> {
		return (await this.ctx.storage.get<unknown[]>("opened")) ?? []
	}
}

// An agent that records what the room delivers to it.
export class AgentDO extends DurableObject {
	async receive(envelopes: { body: string; from: unknown; hop: number }[]): Promise<{ refused: null }> {
		const kept = (await this.ctx.storage.get<unknown[]>("got")) ?? []
		await this.ctx.storage.put("got", [...kept, ...envelopes])
		return { refused: null }
	}
	async got(): Promise<unknown[]> {
		return (await this.ctx.storage.get<unknown[]>("got")) ?? []
	}
	async stop(): Promise<{ discarded: number }> {
		const n = ((await this.ctx.storage.get<number>("stops")) ?? 0) + 1
		await this.ctx.storage.put("stops", n)
		return { discarded: 0 }
	}
	async stops(): Promise<number> {
		return (await this.ctx.storage.get<number>("stops")) ?? 0
	}
	async askAnswered(): Promise<boolean> {
		return false
	}
	async humanComing(): Promise<void> {}
	async wake(): Promise<boolean> {
		return false
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomDO>; USER: DurableObjectNamespace<UserDO>; AGENT: DurableObjectNamespace<AgentDO> }

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, roomId, slug] = new URL(request.url).pathname.split("/")
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
		if (kind === "rpc") {
			const args = (await request.json()) as unknown[]
			const call = (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[slug!]
			return Response.json((await call!(...args)) ?? null)
		}
		if (kind === "kiko") {
			await env.USER.get(env.USER.idFromName("user:alice")).markKiko(roomId!)
			return new Response("ok")
		}
		if (kind === "opened") return Response.json(await env.USER.get(env.USER.idFromName("user:alice")).opened())
		if (kind === "saved") return Response.json(await env.USER.get(env.USER.idFromName("user:alice")).savedMembers(roomId!))
		if (kind === "agent") {
			const agent = env.AGENT.get(env.AGENT.idFromName(`agent:alice:${roomId}:${slug}`))
			return Response.json({ got: await agent.got(), stops: await agent.stops() })
		}
		const headers = new Headers(request.headers)
		headers.set(USER_ID_HEADER, "alice")
		headers.set(ROOM_ID_HEADER, roomId!)
		return stub.fetch(new Request(request, { headers }))
	},
}
