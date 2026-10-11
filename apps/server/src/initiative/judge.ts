import { boolOf, type Judge, type Question } from "@yuki/memory/judge"
import { type BurstCheck, type LoopOp, loopOps, loopQuestions } from "@yuki/memory/loops"

async function ask(judge: Judge, state: Parameters<Judge>[0], questions: Record<string, Question>) {
  try {
    return await judge(state, questions)
  } catch (error) {
    console.error(`judge: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export async function classifyBurst(judge: Judge, check: BurstCheck): Promise<LoopOp[] | null> {
  if (!check.sentences.length) return []
  const { state, questions } = loopQuestions(check)
  const answers = await ask(judge, state, questions)
  return answers ? loopOps(check, answers) : null
}

export type WorthItem = {
  id: string
  what: string
  whose: string
  certainty: string
  due: string
  last_mentioned: string
  raised_before: number
  human_let_pass: number
  agent_declined_before: number
}

const WORTH = {
  true: "the agent should bring it up now: it is due or overdue, a promise is owed, or it has gone quiet too long for its kind, and the history does not say the human already let it pass",
  false: "bringing it up now would nag or interrupt for nothing: not due yet, only an idea, said very recently, already raised and left unanswered, or declined by the agent before",
}

export async function worthNow(judge: Judge, items: readonly WorthItem[], state: Record<string, string | number>): Promise<Record<string, number> | null> {
  if (!items.length) return {}
  const questions: Record<string, Question> = {}
  items.forEach((_, i) => {
    questions[`c${i}`] = { type: "bool", instructions: `Should the agent raise \`candidates[${i}]\` with the human right now, unasked, in one short message?`, criteria: WORTH }
  })
  const answers = await ask(judge, { ...state, candidates: items.map(({ id: _, ...rest }) => rest) }, questions)
  return answers ? Object.fromEntries(items.map((c, i) => [c.id, boolOf(answers[`c${i}`])])) : null
}
