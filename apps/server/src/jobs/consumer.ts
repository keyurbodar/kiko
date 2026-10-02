import type { Env } from "../index"
import type { Fetcher } from "../lib/safe-fetch"
import { handleImageJob, isImageJob, type PreviewImageJob } from "../previews/image-job"
import { type AttachmentJob, handleAttachmentJob, isAttachmentJob } from "./attachment"

// The one queue consumer. Architecture section 7.9. Every job type is in `Job`, and a
// handler is safe to run twice, because a queue delivers at least once. A handler that
// throws is retried with a growing delay. A body that is no known job is dropped.

export type Job = AttachmentJob | PreviewImageJob

const MAX_DELAY_SECONDS = 60

/** Seconds to wait after delivery number `attempts` fails: 1, 2, 4, up to a minute. */
export const retryDelay = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), MAX_DELAY_SECONDS)

async function run(body: unknown, env: Env, attempt: number, fetcher?: Fetcher): Promise<void> {
	if (isAttachmentJob(body)) await handleAttachmentJob(body, env, attempt)
	else if (isImageJob(body)) await handleImageJob(body, env.FILES, fetcher)
}

export async function consume(batch: MessageBatch<unknown>, env: Env, fetcher?: Fetcher): Promise<void> {
	for (const message of batch.messages) {
		try {
			await run(message.body, env, message.attempts, fetcher)
			message.ack()
		} catch {
			message.retry({ delaySeconds: retryDelay(message.attempts) })
		}
	}
}
