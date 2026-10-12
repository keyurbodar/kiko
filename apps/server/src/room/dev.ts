import type { AgentSlug } from "@yuki/protocol"
import { loadRoomDev } from "../lib/dev-guard"
import type { DevDeps, RoomDev as RoomDevImpl } from "./dev-impl"

// One dev facade per Durable Object. Every method reaches the body in dev-impl.ts through loadRoomDev,
// the single guarded entry, so a production bundle carries neither the bodies nor a guard per method.
export class RoomDev {
	#impl: Promise<RoomDevImpl> | null = null
	constructor(private readonly d: DevDeps) {}

	private impl(): Promise<RoomDevImpl> {
		if (!this.#impl) this.#impl = loadRoomDev().then((m) => new m.RoomDev(this.d))
		return this.#impl
	}

	async seed(turns: { from: string; text: string }[]): Promise<number> {
		return (await this.impl()).seed(turns)
	}

	async memory(): Promise<{ turns: number; pending: number; view: string }> {
		return (await this.impl()).memory()
	}

	async quiet(): Promise<void> {
		return (await this.impl()).quiet()
	}

	async age(ms: number): Promise<number> {
		return (await this.impl()).age(ms)
	}

	async agePending(ms: number): Promise<number> {
		return (await this.impl()).agePending(ms)
	}

	async agentMessage(slug: AgentSlug, text: string): Promise<void> {
		return (await this.impl()).agentMessage(slug, text)
	}
}
