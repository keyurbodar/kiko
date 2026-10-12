import type { Env } from "../index"
import { type DeleteAccountJob, deletionTargets, isDeleteAccountJob, runDeleteJob } from "./delete-account"

export type Job = DeleteAccountJob

const MAX_DELAY_SECONDS = 60

export const retryDelay = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), MAX_DELAY_SECONDS)

async function run(body: unknown, env: Env): Promise<void> {
	if (isDeleteAccountJob(body)) await runDeleteJob(body, deletionTargets(env, body.userId))
}

export const DEAD_LETTER_QUEUE = "kiko-jobs-dead"
const REQUEUE_DELAY_SECONDS = 15 * 60

// Deletion must never give up, so a dead one goes back to the main queue. Other dead bodies are dropped.
async function requeueDead(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	for (const message of batch.messages) {
		try {
			if (isDeleteAccountJob(message.body)) {
				const cycles = (message.body.cycles ?? 0) + 1
				console.error(`account deletion still failing after ${cycles} dead-letter ${cycles === 1 ? "cycle" : "cycles"}; requeued (user ${message.body.userId}, room ${message.body.roomId ?? "none"})`)
				await env.JOBS.send({ ...message.body, cycles }, { delaySeconds: REQUEUE_DELAY_SECONDS })
			}
			message.ack()
		} catch {
			message.retry({ delaySeconds: retryDelay(message.attempts) })
		}
	}
}

export async function consume(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	if (batch.queue === DEAD_LETTER_QUEUE) return requeueDead(batch, env)
	for (const message of batch.messages) {
		try {
			await run(message.body, env)
			message.ack()
		} catch (error) {
			console.error(`job failed on attempt ${message.attempts}: ${error instanceof Error ? error.message : String(error)}`)
			message.retry({ delaySeconds: retryDelay(message.attempts) })
		}
	}
}
