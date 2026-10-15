import type { HumanAnswers, HumanAsk, HumanQuestion } from "./room"

export function humanQuestions(ask: HumanAsk): readonly HumanQuestion[] {
  return ask.questions ?? [{ id: "answer", header: "Question", question: ask.text, options: (ask.options ?? []).map((label) => ({ label })) }]
}

export function humanAnswerText(ask: HumanAsk, value: string | HumanAnswers): string | null {
  if (typeof value === "string") return ask.questions ? null : value.trim() || null
  const lines: string[] = []
  for (const q of humanQuestions(ask)) {
    const answer = value[q.id]
    if (Array.isArray(answer)) {
      if (!q.multiSelect || !answer.length || new Set(answer).size !== answer.length || answer.some((v) => !q.options.some((o) => (o.value ?? o.label) === v))) return null
    } else if (typeof answer !== "string" || !answer.trim() || (q.allowCustomAnswer === false && !q.options.some((o) => (o.value ?? o.label) === answer))) return null
    const text = typeof answer === "string" ? (q.options.some((o) => (o.value ?? o.label) === answer) ? answer : answer.trim()) : answer.join(", ")
    lines.push(ask.questions ? `${q.header}: ${text}` : text)
  }
  return lines.join("\n") || null
}
