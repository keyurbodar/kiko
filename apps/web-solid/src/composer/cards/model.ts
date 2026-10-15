import type { HumanAsk, Task } from "@kiko/protocol"
import { taskProgress } from "../../chat/info/tasks-model"

export type ComposerCard =
  | { id: string; kind: "ask"; ask: HumanAsk; title: string }
  | { id: string; kind: "tasks"; title: string }

export function composerCards(asks: readonly HumanAsk[], tasks: readonly Task[]): ComposerCard[] {
  const cards: ComposerCard[] = asks.map((ask) => ({ id: `ask:${ask.id}`, kind: "ask", ask, title: ask.text }))
  const progress = taskProgress(tasks)
  if (progress.current) cards.push({ id: "tasks", kind: "tasks", title: progress.current.title })
  return cards
}
