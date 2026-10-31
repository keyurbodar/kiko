import type { BrowserEvent } from "@kiko/protocol"
import { chunkFrame, codecs, type RequestId } from "../rpc/wire"

export const browserStream = (attachId: string): `browser:${string}` => `browser:${attachId}`

export const browserText = (requestId: RequestId, event: BrowserEvent): string =>
  chunkFrame(requestId, codecs("browser.live")!.encodeChunk([event]))
