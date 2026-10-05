import { Type, type AssistantMessage } from "@earendil-works/pi-ai"
import { AssistantEntry, configure, defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "../effects"
import { MEMORY_NOTE } from "./memory"
import { MESSAGING } from "./messaging"

// Architecture section 8. A private child conversation inside this agent's own object, from
// pi-durable's foreground subagent pattern. The child starts as a copy of this agent without
// this extension, so depth is 1. It is not a room member and posts nothing to the room.
// The child can recall and zoom the chat's memory, but writes none: it cannot judge what is already
// known (OptMem's rule, section 13).
// Effect: `read`. The child is built with the same trust extension, so its own tools keep their
// effects and the gate.

export const SUBAGENT = "subagent"

/** Removal is by name: a child never gets these. */
const NOT_FOR_HELPERS = [SUBAGENT, MESSAGING, MEMORY_NOTE].map((name) => defineExtension({ name }))

export const Subagent: Extension = defineExtension({
	name: SUBAGENT,
	tools: [
		declareEffect("read", defineTool({
			name: "spawn_subagent",
			description: "Delegate a self-contained task to a private helper and get its answer back. Use it for focused research or drafting that would clutter the chat.",
			parameters: Type.Object({ task: Type.String({ description: "What the helper should do, with everything it needs to know" }) }),
			// A rerun after a crash finds the child it made and the submission it sent.
			replay: "safe",
			execute: async ({ task }, api, ctx) => {
				const child = await api.commit(async (tx) => {
					const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0]
					if (existing !== undefined) return existing.id
					const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } })
					// The child is private, so it gets no team tools either (P6-03).
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
				return { content: [{ type: "text", text }], details: { conversationId: child } }
			},
		})),
	],
})
