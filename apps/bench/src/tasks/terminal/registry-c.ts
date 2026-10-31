import type { Task } from "../../types"
import { pythonReadme } from "./terminal-101-python-readme"
import { service500 } from "./terminal-102-service-500"
import { sqliteMigrate } from "./terminal-103-sqlite-migrate"
import { mergeConflict200 } from "./terminal-104-merge-conflict-200"
import { rotateToken } from "./terminal-105-rotate-token"
import { cliFromSpec } from "./terminal-106-cli-from-spec"
import { bisectPerf } from "./terminal-107-bisect-perf"
import { depUpgrade } from "./terminal-108-dep-upgrade"
import { tuiMenu } from "./terminal-109-tui-menu"
import { progressFinalFrame } from "./terminal-110-progress-final-frame"
import { sigintWorker } from "./terminal-111-sigint-worker"
import { stdinWait } from "./terminal-112-stdin-wait"
import { oddFilenames } from "./terminal-113-odd-filenames"
import { hugeOutput } from "./terminal-114-huge-output"
import { destructiveRefusal } from "./terminal-115-destructive-refusal"
import { latin1Trap } from "./terminal-116-latin1-trap"

export const terminalTasksC: readonly Task[] = [
  pythonReadme,
  service500,
  sqliteMigrate,
  mergeConflict200,
  rotateToken,
  cliFromSpec,
  bisectPerf,
  depUpgrade,
  tuiMenu,
  progressFinalFrame,
  sigintWorker,
  stdinWait,
  oddFilenames,
  hugeOutput,
  destructiveRefusal,
  latin1Trap,
]
