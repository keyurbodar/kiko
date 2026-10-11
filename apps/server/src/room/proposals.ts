import type { AgentSlug, RoomEvent, RoomId } from "@yuki/protocol"
import { tagline, type MemberOp } from "@yuki/protocol"
import type { Env } from "../index"
import { roomStub, userStub } from "../lib/names"
import { CHIEF, checkProposal, introduction, type NewAgentSpec, type Proposal, type ProposalInput } from "./chief"
import type { Chat } from "@yuki/protocol"
import type { RoomLog } from "./log"
import type { Members } from "./members"

type Home = { userId: string; roomId: RoomId }

export type ProposalsDeps = {
	ctx: DurableObjectState
	env: Env
	log: RoomLog
	members: Members
	home: () => Home | null
	chat: (home: Home) => Promise<Chat | null>
	publish: (events: RoomEvent[]) => void
	memberOp: (op: MemberOp) => unknown
	writeChatFile: (slug: AgentSlug, text: string) => Promise<unknown>
}

export class Proposals {
	constructor(private readonly d: ProposalsDeps) {}

	async propose(slug: AgentSlug, input: ProposalInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		const home = this.d.home()
		if (!home) return { ok: false, error: "this chat is not set up yet" }
		if (slug !== CHIEF) return { ok: false, error: "only yuki makes agents and groups" }
		const checked = checkProposal(input, await userStub(this.d.env.USER, home.userId).listAgents())
		if ("error" in checked) return { ok: false, error: checked.error }
		const id = crypto.randomUUID().slice(0, 8)
		const runStart = Number(this.d.log.meta(`live:${slug}`) ?? Number.NaN)
		const proposal: Proposal = { ...checked, id, seq: Number.isFinite(runStart) ? Math.min(runStart, this.d.log.lastSeq()) : this.d.log.lastSeq() }
		this.d.log.setMeta(`proposal:${id}`, JSON.stringify(proposal))
		return { ok: true, id }
	}

	open(): string | null {
		const id = this.newest()
		if (!id || this.d.log.meta(`created:${id}`)) return null
		const raw = this.d.log.meta(`proposal:${id}`)
		if (!raw) throw new Error(`no proposal ${id}`)
		const p = JSON.parse(raw) as Proposal
		const what = p.kind === "agent" ? `the agent @${p.agent.handle}` : `the group "${p.title}"`
		return `your proposal of ${what} is not made yet. call create to make it, or propose again.`
	}

	newest(): string | null {
		const rows = this.d.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'proposal:%'").toArray()
		const newest = rows.map((r) => JSON.parse(r.value) as Proposal).sort((a, b) => b.seq - a.seq)[0]
		return newest?.id ?? null
	}

	async create(slug: AgentSlug, id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
		const home = this.d.home()
		if (!home || slug !== CHIEF) return { ok: false, error: "only yuki makes agents and groups" }
		id ||= this.newest() ?? ""
		const done = this.d.log.meta(`created:${id}`)
		if (done) return { ok: true, text: done }
		const raw = this.d.log.meta(`proposal:${id}`)
		if (!raw) return { ok: false, error: `no proposal ${id}. propose first` }
		const proposal = JSON.parse(raw) as Proposal
		const user = userStub(this.d.env.USER, home.userId)
		const model = this.d.members.list().find((m) => m.slug === CHIEF)?.model ?? ""
		const make = async (spec: NewAgentSpec) => {
			const agent = await user.makeAgent({ name: spec.name, slug: spec.handle, description: spec.description, soul: spec.soul, model })
			if (!agent) throw new Error(`@${spec.handle} could not be made (the handle may be taken)`)
			return agent
		}
		let text: string
		try {
			if (proposal.kind === "agent") {
				const agent = await make(proposal.agent)
				const roomId = await user.openChat(agent.name, [agent.id])
				const { event } = this.d.log.addMessage({ from: { kind: "system", reason: "created" }, text: `yuki made @${agent.slug}. say hi in your new chat.`, goto: roomId })
				if (event) this.d.publish([event])
				this.d.ctx.waitUntil(
					roomStub(this.d.env.ROOM, home.userId, roomId)
						.introduce(home.userId, agent.slug, introduction(proposal.agent))
						.catch((e: unknown) => console.error(`introduce failed: ${e instanceof Error ? e.message : String(e)}`)),
				)
				text = `made @${agent.slug}. the human is taken to its chat now; say one short line, nothing more.`
			} else {
				const mine = await user.listAgents()
				const made = []
				for (const spec of proposal.agents) made.push(await make(spec))
				const existing = proposal.members.map((m) => {
					const a = mine.find((x) => x.slug === m)
					if (!a) throw new Error(`@${m} is not your agent`)
					return a
				})
				const members = [...existing, ...made]
				const chat = await this.d.chat(home)
				if (chat?.temp) {
					for (const a of members) {
						const role = tagline(a.prompt)
						this.d.memberOp({ op: "add", slug: a.slug, name: a.name, ...(role ? { role } : {}), ...(a.model ? { model: a.model } : {}) })
					}
					await this.d.writeChatFile(CHIEF, proposal.chat)
					this.d.log.setMeta("chat_file", "1")
					await user.keepChat(home.roomId, proposal.title, [CHIEF, ...members.map((a) => a.id)])
					const { event } = this.d.log.addMessage({ from: { kind: "system", reason: "created" }, text: `yuki started ${proposal.title} with ${members.map((a) => `@${a.slug}`).join(", ")}` })
					if (event) this.d.publish([event])
					text = `the group is ready, here in this chat, with ${members.map((a) => `@${a.slug}`).join(", ")}. /chat.md holds the plan. kick it off in a line or two.`
				} else {
					const roomId = await user.openChat(proposal.title, [CHIEF, ...members.map((a) => a.id)])
					this.d.ctx.waitUntil(
						roomStub(this.d.env.ROOM, home.userId, roomId)
							.startGroup(home.userId, proposal.chat)
							.catch((e: unknown) => console.error(`start group failed: ${e instanceof Error ? e.message : String(e)}`)),
					)
					const { event } = this.d.log.addMessage({ from: { kind: "system", reason: "created" }, text: `yuki started ${proposal.title}. open it to begin.`, goto: roomId })
					if (event) this.d.publish([event])
					text = `the group ${proposal.title} is made, in its own chat. say one short line.`
				}
			}
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
		this.d.log.setMeta(`created:${id}`, text)
		return { ok: true, text }
	}
}
