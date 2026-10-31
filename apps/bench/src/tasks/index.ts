import type { Task } from "../types"
import { countMatches } from "./terminal/count-matches"
import { fixScript } from "./terminal/fix-script"
import { gitBranch } from "./terminal/git-branch"

export const TASKS: readonly Task[] = [countMatches, fixScript, gitBranch]
