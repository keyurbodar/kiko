import type { TerminalEvent } from "@kiko/protocol"
import { chunkFrame, codecs, type RequestId } from "../rpc/wire"

export const terminalStream = (attachId: string): `term:${string}` => `term:${attachId}`

export const terminalText = (requestId: RequestId, event: TerminalEvent): string =>
  chunkFrame(requestId, codecs("terminal.attach")!.encodeChunk([event]))
