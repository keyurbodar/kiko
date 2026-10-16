import type { Judge } from "@kiko/memory/judge"
import { type BurstCheck, type LoopOp, loopOps, loopQuestions } from "@kiko/memory/loops"

export async function classifyBurst(judge: Judge, check: BurstCheck): Promise<LoopOp[] | null> {
  const { state, questions } = loopQuestions(check)
  if (!Object.keys(questions).length) return []
  try {
    const answers = await judge(state, questions)
    return answers ? loopOps(check, answers) : null
  } catch (error) {
    console.error(`judge: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
