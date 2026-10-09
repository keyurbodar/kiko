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

/** Helpers one agent runs at once. They all use the human's one key, so the rest wait for a slot. */
export const MAX_HELPERS = 3

/** A counting semaphore. A waiter whose run is aborted leaves the queue without taking a slot. */
function slots(max: number) {
	let free = max
	const waiting = new Set<() => void>()
	return {
		take(signal: AbortSignal | undefined): Promise<void> {
			if (signal?.aborted) return Promise.reject(signal.reason)
			if (free > 0) {
				free--
				return Promise.resolve()
			}
			return new Promise((resolve, reject) => {
				const go = () => {
					signal?.removeEventListener("abort", stop)
					resolve()
				}
				const stop = () => {
					waiting.delete(go)
					reject(signal?.reason)
				}
				waiting.add(go)
				signal?.addEventListener("abort", stop, { once: true })
			})
		},
		give(): void {
			const next = waiting.values().next().value
			if (next === undefined) return void free++
			waiting.delete(next)
			next()
		},
	}
}

/** One per built agent, so each agent has its own slots. */
export function subagentExtension(): Extension {
	const helpers = slots(MAX_HELPERS)
	return defineExtension({
		name: SUBAGENT,
		tools: [
			declareEffect("read", defineTool({
				name: "spawn_subagent",
				description: `Delegate a self-contained task to a private helper and get its answer back. Use it for focused research or drafting that would clutter the chat. To run several helpers at once, call this tool several times in one reply. Up to ${MAX_HELPERS} run together and the rest wait their turn.`,
				parameters: Type.Object({ task: Type.String({ description: "What the helper should do, with everything it needs to know" }) }),
				replay: "safe",
				execute: async ({ task }, api, ctx) => {
					await helpers.take(ctx.abortSignal)
					try {
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
					} finally {
						helpers.give()
					}
				},
			})),
		],
	})
}
