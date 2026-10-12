import { MAX_MESSAGE_TEXT } from "@yuki/protocol"
import { sha256Hex } from "@yuki/durable/hash"
import { deleteFiles, fileKey } from "../files/upload"

// A long message's whole text is stored as this file. The name is what the agent reads in its envelope.
export const WHOLE_NAME = "message.txt"
export const WHOLE_TYPE = "text/plain"

/**
 * Most of a bubble's JSON. The agent's inbox entry is 128 KB and holds the bubble with its brief and
 * context, so a control character (6 bytes of JSON) cannot push one entry past the cap.
 */
export const MAX_BUBBLE_BYTES = 64 * 1024

export type WholeText = { id: string; r2Key: string; size: number; sha256: string }

/** The bubble's text: the first part of a long message, within `MAX_MESSAGE_TEXT` characters and `MAX_BUBBLE_BYTES` of JSON. The cut never splits a code point. */
export function bubbleOf(text: string): string {
	let end = 0
	let bytes = 0
	for (const ch of text) {
		if (end + ch.length > MAX_MESSAGE_TEXT) break
		bytes += new TextEncoder().encode(JSON.stringify(ch)).length - 2
		if (bytes > MAX_BUBBLE_BYTES) break
		end += ch.length
	}
	return text.slice(0, end)
}

/** A UUID-shaped id that one client id always gives, so a resend names the same file. */
export async function fileIdOf(clientId: string): Promise<string> {
	const hex = await sha256Hex(`text:${clientId}`)
	return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-")
}

/**
 * Writes a send's whole text to R2 before its transaction. The key comes from the client id, which a
 * resend repeats, so the resend writes the same object again.
 */
export async function putWhole(bucket: R2Bucket, home: { userId: string; roomId: string }, clientId: string, text: string): Promise<WholeText> {
	const body = new TextEncoder().encode(text)
	const id = await fileIdOf(clientId)
	const r2Key = fileKey(home.userId, home.roomId, id)
	await bucket.put(r2Key, body, { httpMetadata: { contentType: WHOLE_TYPE } })
	return { id, r2Key, size: body.length, sha256: await sha256Hex(body) }
}

/** Deletes a whole text whose send did not store, so a refused send leaves no object behind. */
export function discardWhole(bucket: R2Bucket, whole: WholeText): Promise<void> {
	return deleteFiles(bucket, whole.r2Key)
}
