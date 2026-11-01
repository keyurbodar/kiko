import type { Task } from "../../types"
import { envCopyBetweenComputers } from "./env-001-copy-between-computers"
import { envReconnectMidCall } from "./env-002-reconnect-mid-call"
import { envPickTheBox } from "./env-003-pick-the-box"
import { envMissingCapability } from "./env-004-missing-capability"

export const envTasks: readonly Task[] = [
  envCopyBetweenComputers,
  envReconnectMidCall,
  envPickTheBox,
  envMissingCapability,
]
