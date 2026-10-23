import type { FileBucket } from "../files/store"
import { MAX_MESSAGE_TEXT } from "@kiko/protocol"
import { sha256Hex } from "@kiko/durable/hash"
import { deleteFiles, fileKey } from "../files/upload"

export const WHOLE_NAME = "message.txt"
export const WHOLE_TYPE = "text/plain"

const MAX_BUBBLE_BYTES = 64 * 1024

export type WholeText = { id: string; r2Key: string; size: number; sha256: string }

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

async function fileIdOf(clientId: string): Promise<string> {
  const hex = await sha256Hex(`text:${clientId}`)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-")
}

export async function putWhole(
  bucket: FileBucket,
  home: { userId: string; roomId: string },
  clientId: string,
  text: string,
): Promise<WholeText> {
  const body = new TextEncoder().encode(text)
  const id = await fileIdOf(clientId)
  const r2Key = fileKey(home.userId, home.roomId, id)
  await bucket.put(r2Key, body, { httpMetadata: { contentType: WHOLE_TYPE } })
  return { id, r2Key, size: body.length, sha256: await sha256Hex(body) }
}

export function discardWhole(bucket: FileBucket, whole: WholeText): Promise<void> {
  return deleteFiles(bucket, whole.r2Key)
}
