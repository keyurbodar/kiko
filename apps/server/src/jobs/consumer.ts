import type { Env } from "../index"
import { type AttachmentJob, handleAttachmentJob, isAttachmentJob } from "./attachment"
import { type DeleteAccountJob, deletionTargets, isDeleteAccountJob, runDeleteJob } from "./delete-account"

// The one queue consumer. Architecture section 7.9. Every job type is in `Job`, and a
// handler is safe to run twice, because a queue delivers at least once. A handler that
// throws is retried with a growing delay. A body that is no known job is dropped.

export type Job = AttachmentJob | DeleteAccountJob

const MAX_DELAY_SECONDS = 60

/** Seconds to wait after delivery number `attempts` fails: 1, 2, 4, up to a minute. */
export const retryDelay = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), MAX_DELAY_SECONDS)

async function run(body: unknown, env: Env, attempt: number): Promise<void> {
	if (isAttachmentJob(body)) await handleAttachmentJob(body, env, attempt)
	else if (isDeleteAccountJob(body)) await runDeleteJob(body, deletionTargets(env, body.userId))
}

/** The dead-letter queue in wrangler.jsonc. A job lands there after 100 failed deliveries. */
export const DEAD_LETTER_QUEUE = "kiko-jobs-dead"
/** How long a dead account deletion waits before it goes back to the main queue. */
const REQUEUE_DELAY_SECONDS = 15 * 60

/**
 * A dead account deletion goes back to the main queue, because deletion must never give
 * up. Every other dead job is dropped: it only fills in optional data.
 */
async function requeueDead(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	for (const message of batch.messages) {
		try {
			if (isDeleteAccountJob(message.body)) await env.JOBS.send(message.body, { delaySeconds: REQUEUE_DELAY_SECONDS })
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
			await run(message.body, env, message.attempts)
			message.ack()
		} catch {
			message.retry({ delaySeconds: retryDelay(message.attempts) })
		}
	}
}
