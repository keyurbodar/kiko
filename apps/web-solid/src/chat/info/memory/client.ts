import type { MemoryOp, MemoryResult } from "@kiko/protocol"
import { failureMessage, owner, run } from "../../../state/runtime"

export type MemoryClient = {
  request(op: MemoryOp): Promise<MemoryResult>
}

export const memoryClient: MemoryClient = {
  async request(op) {
    const result = await run(owner.commands.memory, { op })
    return result._tag === "Success"
      ? result.value
      : { ok: false, error: failureMessage(result.cause, "Kiko could not reach your memory. Try again.") }
  },
}
