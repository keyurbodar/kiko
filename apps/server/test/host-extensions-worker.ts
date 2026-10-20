import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import type { AgentSetup } from "@kiko/agent/host"
import type { Envelope } from "@kiko/protocol"
import { AgentProbe as AgentDO, agentObject } from "./agent-service"
import { buildAgent } from "../src/agent/factory"
import type { RoomPort } from "../src/agent/outbox"

type Body = { op: "browser"; on: boolean } | { op: "reopen" } | { op: "turn"; n: number }

let browserOn = false
let seen: string[] = []

const stub = new Proxy({}, { get: () => () => ({}) }) as never

class TService extends AgentDO {
	protected override roomPort(): RoomPort {
		return { post: async () => {}, draft: async () => {}, note: async () => {}, status: async () => {}, workers: async () => {}, endRun: async () => {}, react: async () => {} }
	}

	protected override async setup(): Promise<AgentSetup> {
		const faux = fauxProvider({ tokensPerSecond: 1000 })
		const models = createModels()
		models.setProvider(faux.provider)
		faux.setResponses(
			Array.from({ length: 20 }, () => (request: { tools?: { name: string }[]; messages: { role: string; toolsAdded?: { name: string }[] }[] }) => {
				const added = request.messages.flatMap((m) => (m.role === "system" ? (m.toolsAdded ?? []) : []))
				seen = [...(request.tools ?? []), ...added].map((t) => t.name)
				return fauxAssistantMessage("ok")
			}),
		)
		const browser = browserOn ? { connection: stub, lease: stub, acceptsImages: () => false } : undefined
		const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, ...(browser ? { browser } : {}), work: this.host.workers })
		return { models, ...built, beginRun: async () => true }
	}

	override async fetch(request: Request): Promise<Response> {
		const body = (await request.json()) as Body
		if (body.op === "browser") {
			browserOn = body.on
			return Response.json(true)
		}
		if (body.op === "reopen") {
			// What an eviction does, or a stale agent after a key is added: the host opens again with a new setup.
			const self = this as unknown as { hostInstance?: AgentDO["host"]; outboxInstance?: unknown }
			await self.hostInstance?.shutdown()
			self.hostInstance = undefined
			self.outboxInstance = undefined
			await this.host.open()
			return Response.json(true)
		}
		const envelope: Envelope = { id: `human:t${body.n}`, roomId: "01J00000000000000000000000" as Envelope["roomId"], from: { kind: "human" }, body: "hi", hop: 0, rootId: `t${body.n}`, seq: body.n }
		await this.receive([envelope], "")
		await this.alarm()
		const opened = await this.host.open()
		await opened.harness.waitForIdle(BACKGROUND_CONTEXT)
		await this.alarm()
		return Response.json(seen)
	}
}

export default {
	async fetch() {
		return new Response("not found", { status: 404 })
	},
}

export const T = agentObject(TService)
