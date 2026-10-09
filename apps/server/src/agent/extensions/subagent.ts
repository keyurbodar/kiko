import { Type, type AssistantMessage } from "@earendil-works/pi-ai"
import { AssistantEntry, configure, defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { CHIEF_EXT } from "./chief"
import { MEMORY_NOTE } from "@yuki/memory/tools"
import { MESSAGING } from "./messaging"
import { REMINDERS } from "./reminders"
import { isRunTainted, markRunTainted } from "@yuki/agent/trust"
import { WORKSPACE } from "./workspace"

export const SUBAGENT = "subagent"

export const NOT_FOR_HELPERS = [SUBAGENT, MESSAGING, MEMORY_NOTE, CHIEF_EXT, REMINDERS, WORKSPACE].map((name) => defineExtension({ name }))

export const Subagent: Extension = defineExtension({
	name: SUBAGENT,
	tools: [
		declareEffect("read", defineTool({
			name: "spawn_subagent",
			description: "Delegate a self-contained task to a private helper and get its answer back. Use it for focused research or drafting that would clutter the chat.",
			parameters: Type.Object({ task: Type.String({ description: "What the helper should do, with everything it needs to know" }) }),
			replay: "safe",
			execute: async ({ task }, api, ctx) => {
				const child = await api.commit(async (tx) => {
					const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0]
					if (existing !== undefined) return existing.id
					const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } })
					await configure(tx, created.id, { extensions: { remove: NOT_FOR_HELPERS } })
					return created.id
				}, ctx)
				await api.details({ conversationId: child }, ctx)
				const handle = (await api.conversation(child, ctx))!
				const request = { type: "input", content: task, requestId: `subagent:${api.taskId}` } as const
				const settled = await (await handle.submit(request, ctx)).wait(ctx)
				if (settled.status !== "done" || settled.type !== "input") throw new Error(`the helper stopped: ${settled.status}`)
				const entry = await api.commit((tx) => tx.entry(AssistantEntry, settled.answer), ctx)
				const message = entry?.model?.[0] as AssistantMessage | undefined
				const text = (message?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")
				if (isRunTainted({ registry: api.registry, conversationId: child })) markRunTainted(api, "helper")
				return { content: [{ type: "text", text }], details: { conversationId: child } }
			},
		})),
	],
})
