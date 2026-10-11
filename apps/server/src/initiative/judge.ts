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

const ANSWERS = {
  true: "the human replies to it: answers it, says it is done, not yet, or not wanted, or takes it up",
  false: "the human writes about something else and leaves it unanswered",
}

/** `asked`: what the agent raised unasked in this chat, and the human's messages since, to judge whether they answer it. */
export async function classifyBurst(judge: Judge, check: BurstCheck, asked: { nudges: readonly string[]; said: readonly string[] } = { nudges: [], said: [] }): Promise<{ ops: LoopOp[]; answered: number[] } | null> {
  const { state, questions } = loopQuestions(check)
  asked.nudges.forEach((_, i) => {
    questions[`n${i}`] = { type: "bool", instructions: `The agent raised \`nudges[${i}]\` unasked. Do the human's messages in \`human_said\` answer it?`, criteria: ANSWERS }
  })
  if (!Object.keys(questions).length) return { ops: [], answered: [] }
  const answers = await ask(judge, asked.nudges.length ? { ...state, nudges: [...asked.nudges], human_said: [...asked.said] } : state, questions)
  if (!answers) return null
  return { ops: loopOps(check, answers), answered: asked.nudges.flatMap((_, i) => (boolOf(answers[`n${i}`]) > 0.5 ? [i] : [])) }
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
