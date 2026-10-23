import type { ComputerFrame } from "@kiko/protocol"
import { chunkFrame, codecs, type RequestId } from "../rpc/wire"

export type FrameSubscription = { readonly requestId: RequestId; readonly stream: string }

export const frameStream = (pcId: string): `pc:${string}` => `pc:${pcId}`

export function frameSubs(attachment: unknown, pcId: string): readonly FrameSubscription[] {
  const saved = attachment as { rpc?: readonly FrameSubscription[] } | null
  const stream = frameStream(pcId)
  return (saved?.rpc ?? []).filter((sub) => sub.stream === stream)
}

export function frameChunk(frame: ComputerFrame): unknown {
  return codecs("pc.frames")!.encodeChunk([frame])
}

export const frameText = (requestId: RequestId, values: unknown): string => chunkFrame(requestId, values)
