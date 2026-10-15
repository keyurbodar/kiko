import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js"
import { humanQuestions, type HumanAsk, type HumanAnswers } from "@kiko/protocol"
import { buildPendingUserInputAnswers, derivePendingUserInputProgress, setPendingUserInputCustomAnswer, togglePendingUserInputOptionSelection, type PendingUserInputDraftAnswer } from "./question-model"

export function createQuestionInput(asks: Accessor<readonly HumanAsk[]>, send: (ask: HumanAsk, answers: HumanAnswers) => void, skip: (id: string) => void, storage: { key: Accessor<string | undefined>; load: (id: string) => string; save: (id: string, value: string) => void }) {
  const ask = createMemo(() => asks()[0])
  const questions = createMemo(() => ask() ? humanQuestions(ask()!) : [])
  const [answers, setAnswers] = createSignal<Record<string, PendingUserInputDraftAnswer>>({})
  const [index, setIndex] = createSignal(0)
  createEffect(on(() => [ask()?.id, storage.key()] as const, ([id, key]) => {
    let saved: { answers?: Record<string, PendingUserInputDraftAnswer>; index?: number } = {}
    try { saved = JSON.parse(id && key ? storage.load(id) || "{}" : "{}") ?? {} } catch {}
    setAnswers(saved.answers ?? {})
    setIndex(saved.index ?? 0)
  }))
  const persist = () => {
    const id = ask()?.id
    if (id && storage.key()) storage.save(id, JSON.stringify({ answers: answers(), index: index() }))
  }
  const progress = createMemo(() => derivePendingUserInputProgress(questions(), answers(), index()))
  const advance = () => {
    const p = progress()
    if (!p.canAdvance) return
    if (!p.isLastQuestion) { setIndex(p.questionIndex + 1); persist(); return }
    const values = buildPendingUserInputAnswers(questions(), answers())
    if (values && ask()) send(ask()!, values)
  }
  return {
    ask, answers, progress, advance,
    previous: () => { setIndex(Math.max(0, index() - 1)); persist() },
    skip: () => { if (ask()) skip(ask()!.id) },
    custom(value: string) {
      const q = progress().activeQuestion
      if (q && q.allowCustomAnswer !== false && (answers()[q.id]?.customAnswer ?? "") !== value) {
        setAnswers((all) => ({ ...all, [q.id]: setPendingUserInputCustomAnswer(all[q.id], value) }))
        persist()
      }
    },
    select(value: string) {
      const q = progress().activeQuestion
      if (!q) return
      setAnswers((all) => ({ ...all, [q.id]: togglePendingUserInputOptionSelection(q, all[q.id], value) }))
      persist()
      if (!q.multiSelect) advance()
    },
  }
}
export type QuestionInput = ReturnType<typeof createQuestionInput>
