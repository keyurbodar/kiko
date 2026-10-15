import type { AgentStatus, HumanAsk, Message, Task } from "@kiko/protocol"
import { taskProgress } from "../../chat/info/tasks-model"

export type ComposerCard =
  | { id: string; kind: "ask"; ask: HumanAsk; title: string }
  | { id: string; kind: "tasks"; title: string }
  | { id: string; kind: "provider"; title: string }
  | { id: string; kind: "activity"; agent: AgentStatus; title: string }
  | { id: string; kind: "created"; message: Message; title: string }

export function activityTitle(agent: AgentStatus): string {
  const a = agent.activity
  if (a?.kind === "tool" || a?.kind === "failed") return a.caption.charAt(0).toUpperCase() + a.caption.slice(1)
  if (a?.kind === "waiting") return `Waiting on @${a.on}`
  if (a?.kind === "background") return a.workers.find((w) => w.status === "running")?.task ?? "Working in the background"
  return agent.doing ?? (agent.state === "typing" ? "Writing" : "Working")
}

export function composerCards(asks: readonly HumanAsk[], tasks: readonly Task[], agents: readonly AgentStatus[], messages: readonly Message[], dismissed: ReadonlySet<string>): ComposerCard[] {
  const cards: ComposerCard[] = asks.map((ask) => ({ id: `ask:${ask.id}`, kind: "ask", ask, title: ask.text }))
  const progress = taskProgress(tasks)
  if (progress.current) cards.push({ id: "tasks", kind: "tasks", title: progress.current.title })
  for (const agent of agents) if (agent.state !== "idle" && !asks.some((a) => a.from === agent.slug)) cards.push({ id: `activity:${agent.slug}`, kind: "activity", agent, title: activityTitle(agent) })
  const created = [...messages].reverse().find((m) => m.goto)
  if (created && !dismissed.has(created.id)) cards.push({ id: `created:${created.id}`, kind: "created", message: created, title: created.event?.kind === "created" && "title" in created.event ? String(created.event.title) : "Chat is ready" })
  return cards
}
