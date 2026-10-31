import type { ComputerFrame } from "@kiko/protocol"
import { chunkFrame, codecs, type RequestId } from "../rpc/wire"

export type FrameSubscription = { readonly requestId: RequestId; readonly stream: string }

const PC_STREAM = "pc:"

export const frameStream = (pcId: string): `pc:${string}` => `${PC_STREAM}${pcId}`

export const framePcId = (stream: string): string | null =>
  stream.startsWith(PC_STREAM) ? stream.slice(PC_STREAM.length) : null

export function frameSubs(attachment: unknown, pcId: string): readonly FrameSubscription[] {
  const saved = attachment as { rpc?: readonly FrameSubscription[] } | null
  const stream = frameStream(pcId)
  return (saved?.rpc ?? []).filter((sub) => sub.stream === stream)
}

export function frameChunk(frame: ComputerFrame): unknown {
  return codecs("pc.frames")!.encodeChunk([frame])
}

export const frameText = (requestId: RequestId, values: unknown): string => chunkFrame(requestId, values)
