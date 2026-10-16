import { type Agent, type AgentSlug, type RoomEvent, tagline } from "@kiko/protocol"
import { sha256Hex } from "@kiko/durable/hash"
import type { Env } from "../index"
import { roomStub, userStub } from "../lib/names"
import { CHIEF, checkGroup, groupChatFile, type GroupInput, type NewAgentSpec } from "./chief"
import { makeAgentChat } from "./new-agent"
import type { Home } from "./home"
import type { RoomLog } from "./log"
import type { Members } from "./members"

export type GroupResult = { ok: true; text: string } | { ok: false; error: string }

type GroupsDeps = {
	ctx: DurableObjectState
	env: Env
	log: RoomLog
	members: Members
	home: () => Home | null
	publish: (events: RoomEvent[]) => void
}

/**
 * Makes agents and groups in one call each. A repeat of the same call returns the first answer,
 * so a replayed tool call makes nothing twice.
 */
export class Groups {
	constructor(private readonly d: GroupsDeps) {}

	async createAgent(slug: AgentSlug, spec: NewAgentSpec): Promise<GroupResult> {
		const home = this.d.home()
		if (!home || slug !== CHIEF) return { ok: false, error: "only kiko makes agents" }
		const key = `made:agent:${spec.handle.trim().toLowerCase().replace(/^@/, "")}`
		const done = this.d.log.meta(key)
		if (done) return { ok: true, text: done }
		const user = userStub(this.d.env.USER, home.userId)
		try {
			const model = this.model()
			const made = await makeAgentChat(
				{
					agents: () => user.listAgents(),
					make: (spec) => user.makeAgent({ name: spec.name, slug: spec.handle, description: spec.description, soul: spec.soul, model }),
					openChat: (title, agentIds) => user.openChat(title, agentIds),
					recipes: (description) => user.recipeHints(description),
					introduce: (roomId, agent, text) => roomStub(this.d.env.ROOM, home.userId, roomId).introduce(home.userId, agent.slug, text),
				},
				spec,
				"kiko",
			)
			if (!made.ok) return made
			const { agent, roomId } = made
			const { event } = this.d.log.addMessage({ from: { kind: "system", reason: "created" }, text: `${agent.name} is ready.`, clientId: key, goto: roomId, event: { kind: "created", roomId, title: agent.name } })
			if (event) this.d.publish([event])
			this.d.ctx.waitUntil(made.introduced)
			const text = `made @${agent.slug}. the human can open its chat now; say one short line, nothing more.`
			this.d.log.setMeta(key, text)
			return { ok: true, text }
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
	}

	async createGroup(slug: AgentSlug, input: GroupInput): Promise<GroupResult> {
		const home = this.d.home()
		if (!home) return { ok: false, error: "this chat is not set up yet" }
		if (!this.d.members.get(slug)) return { ok: false, error: "you are not a member of this chat" }
		const key = `made:group:${(await sha256Hex(JSON.stringify([slug, input]))).slice(0, 16)}`
		const done = this.d.log.meta(key)
		if (done) return { ok: true, text: done }
		const user = userStub(this.d.env.USER, home.userId)
		const mine = await user.listAgents()
		const checked = checkGroup(input, slug, mine)
		if ("error" in checked) return { ok: false, error: checked.error }
		try {
			const made: Agent[] = []
			for (const spec of checked.newAgents) made.push(await this.make(home, spec))
			const picked = [...checked.members.map((m) => this.owned(mine, m)), ...made]
			const creator = slug === CHIEF ? [] : [this.owned(mine, slug)]
			const everyone = [...creator, ...picked]
			const role = (a: Agent) => tagline(a.prompt)
			const chat = groupChatFile(checked.title, checked.goal, [{ slug: CHIEF, role: "leads" }, ...everyone.map((a) => ({ slug: a.slug, role: role(a) }))])
			if (typeof chat !== "string") return { ok: false, error: chat.error }
			// A group is always its own chat. Asking again for the same agents names the chat already made.
			const { roomId, created } = await user.openChat(checked.title, [CHIEF, ...everyone.map((a) => a.id)])
			await roomStub(this.d.env.ROOM, home.userId, roomId)
				.startGroup(home.userId, { chat: created ? chat : null, creator: slug, kickoff: checked.kickoff })
				.catch((e: unknown) => console.error(`start group failed: ${e instanceof Error ? e.message : String(e)}`))
			const { event } = this.d.log.addMessage({ from: { kind: "system", reason: "created" }, text: `${checked.title} is ready.`, clientId: key, event: { kind: "created", roomId, title: checked.title }, goto: roomId })
			if (event) this.d.publish([event])
			const text = created
				? `the group ${checked.title} is made, in its own chat, and your kickoff is sent. you lead it there from here, so do not relay it in this chat. say one short line.`
				: `the group ${checked.title} is already in its own chat. your kickoff is sent there, and you lead it there. say one short line.`
			this.d.log.setMeta(key, text)
			return { ok: true, text }
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
	}

	private owned(mine: readonly Agent[], slug: string): Agent {
		const a = mine.find((x) => x.slug === slug)
		if (!a) throw new Error(`@${slug} is not your agent`)
		return a
	}

	private model(): string {
		return this.d.members.list().find((m) => m.slug === CHIEF)?.model ?? ""
	}

	private async make(home: Home, spec: NewAgentSpec): Promise<Agent> {
		const agent = await userStub(this.d.env.USER, home.userId).makeAgent({ name: spec.name, slug: spec.handle, description: spec.description, soul: spec.soul, model: this.model() })
		if (!agent) throw new Error(`@${spec.handle} could not be made (the handle may be taken)`)
		return agent
	}
}
