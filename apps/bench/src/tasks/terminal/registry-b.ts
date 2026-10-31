import type { Task } from "../../types"
import { chainedJobs } from "./terminal-013-chained-jobs"
import { unicodeLongOutput } from "./terminal-014-unicode-long-output"
import { largestFiles } from "./terminal-015-largest-files"
import { extractArchive } from "./terminal-016-extract-archive"
import { fixPermissions } from "./terminal-017-fix-permissions"
import { jsonTransform } from "./terminal-018-json-transform"
import { csvDedupe } from "./terminal-019-csv-dedupe"
import { freeBusyPort } from "./terminal-020-free-busy-port"
import { makefileTarget } from "./terminal-021-makefile-target"
import { recoverStash } from "./terminal-022-recover-stash"
import { buildMode } from "./terminal-023-build-mode"
import { checksumAudit } from "./terminal-024-checksum-audit"

export const terminalTasksB: readonly Task[] = [
  chainedJobs,
  unicodeLongOutput,
  largestFiles,
  extractArchive,
  fixPermissions,
  jsonTransform,
  csvDedupe,
  freeBusyPort,
  makefileTarget,
  recoverStash,
  buildMode,
  checksumAudit,
]
