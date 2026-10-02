import type { Env } from "../index"
import { roomStub } from "../lib/names"
import { computeThumbhash, HEADER_BYTES, MAX_DECODE_BYTES, readDimensions } from "./image"

// Architecture section 7.9. After an upload the Worker queues one job per new file. The job
// computes only what the client did not send, then writes it to the room with a call that
// fills empty fields and changes nothing else, so a second delivery is a no-op.

export const ATTACHMENT_JOB = "attachment"

export interface AttachmentJob {
	type: typeof ATTACHMENT_JOB
	userId: string
	roomId: string
	fileId: string
	/** Development only: fail this many deliveries first, to prove retry. */
	failures?: number
}

export function isAttachmentJob(value: unknown): value is AttachmentJob {
	const job = value as Partial<AttachmentJob> | null
	return (
		job?.type === ATTACHMENT_JOB &&
		typeof job.userId === "string" &&
		typeof job.roomId === "string" &&
		typeof job.fileId === "string"
	)
}

export const isImageType = (type: string) => type.startsWith("image/")

/** Queues the job when the file is an image that lacks some metadata. */
export async function enqueueAttachment(
	env: Pick<Env, "JOBS">,
	userId: string,
	roomId: string,
	file: { id: string; type: string; width?: number; height?: number; thumbhash?: string },
	failures?: number,
): Promise<boolean> {
	if (!env.JOBS || !isImageType(file.type)) return false
	if (file.width && file.height && file.thumbhash) return false
	const job: AttachmentJob = { type: ATTACHMENT_JOB, userId, roomId, fileId: file.id }
	if (failures) job.failures = failures
	await env.JOBS.send(job)
	return true
}

export type AttachmentResult = "updated" | "unchanged" | "gone"

/** Safe to run twice: it computes only missing fields and the room fills only empty ones. */
export async function handleAttachmentJob(job: AttachmentJob, env: Env, attempt: number): Promise<AttachmentResult> {
	if (job.failures && attempt <= job.failures) throw new Error(`simulated failure ${attempt}`)
	const room = roomStub(env.ROOM, job.userId, job.roomId)
	const known = await room.fileMeta(job.fileId)
	if (!known || !isImageType(known.type)) return "gone"
	if (known.width && known.height && known.thumbhash) return "unchanged"

	const full = known.size <= MAX_DECODE_BYTES
	const object = await env.FILES.get(known.r2Key, full ? undefined : { range: { offset: 0, length: HEADER_BYTES } })
	if (!object) return "gone"
	const bytes = new Uint8Array(await object.arrayBuffer())

	const size = known.width && known.height ? { width: known.width, height: known.height } : readDimensions(bytes)
	if (!size) return "unchanged"
	const meta: { width?: number; height?: number; thumbhash?: string } = {}
	if (!known.width || !known.height) Object.assign(meta, size)
	if (!known.thumbhash && full) {
		const hash = computeThumbhash(bytes, size)
		if (hash) meta.thumbhash = hash
	}
	if (!Object.keys(meta).length) return "unchanged"
	return (await room.setFileMeta(job.fileId, meta)) ? "updated" : "unchanged"
}
