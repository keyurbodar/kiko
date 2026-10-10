import type { JsonObject } from "@earendil-works/pi-ai"
import type { Judge, Question } from "@yuki/memory/judge"
import { type BurstCheck, type LoopOp, loopOps, loopQuestions } from "@yuki/memory/loops"
import { Context, Data, Effect, Layer } from "effect"

// The initiative judge (architecture section 26). One service, two layers: Jev, which wraps the
// user's judge from `UserDO.judge` and never reads a key itself, and the model-free layer, which
// answers "unknown" so the agent's own run decides. A Jev call that fails falls back for that call.

export class JudgeUnavailable extends Data.TaggedError("JudgeUnavailable")<{ reason: string }> {}

export type Unknown = "unknown"
export type Worth = { id: string; p: number }
/** One candidate as Jev reads it: an open loop, a stalled task, or a routine in trouble. */
export type WorthItem = { id: string; text: string; kind: string; certainty: string; owner: string; due: string | null; lastSeen: number; surfaced: number; ignored: number }

export class LoopJudge extends Context.Service<
  LoopJudge,
  {
    /** What a human burst opens or closes. */
    classifyBurst(check: BurstCheck): Effect.Effect<LoopOp[] | Unknown, JudgeUnavailable>
    /** For the attention pass: how worth raising each candidate is now, given `state`. */
    worthNow(candidates: readonly WorthItem[], state: JsonObject): Effect.Effect<Worth[] | Unknown, JudgeUnavailable>
  }
>()("yuki/initiative/LoopJudge") {}

const ask = <K extends string>(judge: Judge, state: JsonObject, questions: Record<K, Question>) =>
  Effect.flatMap(
    Effect.tryPromise(() => judge(state, questions)).pipe(Effect.mapError(() => new JudgeUnavailable({ reason: "error" }))),
    (answers) => (answers ? Effect.succeed(answers) : Effect.fail(new JudgeUnavailable({ reason: "no answer" }))),
  )

const WORTH = {
  true: "raising it now would help the human: it is due soon, they would want a hand, or it has gone quiet too long for its kind",
  false: "raising it now would interrupt for nothing: it is not due, already handled, only an idea, or they would find it nagging",
}

export const JevJudge = (judge: Judge) =>
  Layer.succeed(LoopJudge, {
    classifyBurst: (check) => {
      if (!check.sentences.length) return Effect.succeed([])
      const { state, questions } = loopQuestions(check)
      return Effect.map(ask(judge, state, questions), (answers) => loopOps(check, answers))
    },
    worthNow: (candidates, state) => {
      if (!candidates.length) return Effect.succeed([])
      const questions: Record<string, Question> = {}
      candidates.forEach((_, i) => {
        questions[`c${i}`] = { type: "bool", instructions: `Given \`now\`, is it worth raising \`candidates[${i}]\` with the human right now?`, criteria: WORTH }
      })
      const input = { ...state, candidates: candidates.map((c) => ({ text: c.text, kind: c.kind, certainty: c.certainty, owner: c.owner, due: c.due ?? "none", last_mentioned: new Date(c.lastSeen).toISOString(), raised_before: c.surfaced, ignored_before: c.ignored })) }
      return Effect.map(ask(judge, input, questions), (answers) => candidates.map((c, i) => ({ id: c.id, p: answers[`c${i}`]?.type === "bool" ? (answers[`c${i}`] as { probability: number }).probability : 0 })))
    },
  })

const modelFree: LoopJudge["Service"] = {
  classifyBurst: () => Effect.succeed("unknown"),
  worthNow: () => Effect.succeed("unknown"),
}

export const ModelFreeJudge = Layer.succeed(LoopJudge, modelFree)

/** Runs `use` with Jev when a judge exists, else model-free. A Jev failure falls back for this call only. */
export function judged<A>(judge: Judge | null, use: (j: LoopJudge["Service"]) => Effect.Effect<A, JudgeUnavailable>): Promise<A> {
  const program = Effect.gen(function* () {
    return yield* use(yield* LoopJudge)
  })
  const viaJev = judge ? program.pipe(Effect.provide(JevJudge(judge))) : program.pipe(Effect.provide(ModelFreeJudge))
  return Effect.runPromise(viaJev.pipe(Effect.catchTag("JudgeUnavailable", () => use(modelFree))))
}
