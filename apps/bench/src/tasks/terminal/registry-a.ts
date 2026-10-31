import type { Task } from "../../types"
import { logTriage } from "./terminal-001-log-triage-awk"
import { fixFailingTest } from "./terminal-002-fix-failing-test"
import { gitRebaseConflict } from "./terminal-003-git-rebase-conflict"
import { gitBisect } from "./terminal-004-git-bisect"
import { gitCherryPick } from "./terminal-005-git-cherry-pick"
import { waitForJob } from "./terminal-006-wait-for-job"
import { pythonInput } from "./terminal-007-python-input"
import { confirmInstaller } from "./terminal-008-confirm-installer"
import { vimEdit } from "./terminal-009-vim-edit"
import { pagerSearch } from "./terminal-010-pager-search"
import { sshLocalhost } from "./terminal-011-ssh-localhost"
import { pathDeploy } from "./terminal-012-path-deploy"

export const terminalTasksA: readonly Task[] = [
  logTriage,
  fixFailingTest,
  gitRebaseConflict,
  gitBisect,
  gitCherryPick,
  waitForJob,
  pythonInput,
  confirmInstaller,
  vimEdit,
  pagerSearch,
  sshLocalhost,
  pathDeploy,
]
