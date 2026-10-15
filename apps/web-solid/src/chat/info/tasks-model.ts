import type { Agent, Member, Task, TaskStatus } from "@kiko/protocol"

export const TASK_ORDER: readonly TaskStatus[] = ["doing", "blocked", "todo", "review", "done", "cancelled"]
export const TASK_LABEL: Record<TaskStatus, string> = { doing: "Running", blocked: "Blocked", todo: "Pending", review: "In review", done: "Completed", cancelled: "Cancelled" }
export const openTasks = (tasks: readonly Task[]) => tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
export const groupTasks = (tasks: readonly Task[]) => TASK_ORDER.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) })).filter((g) => g.tasks.length)

export function taskProgress(tasks: readonly Task[]) {
  const steps = tasks.filter((t) => t.status !== "cancelled")
  const current = steps.find((t) => t.status === "doing") ?? steps.find((t) => t.status === "review") ?? steps.find((t) => t.status !== "done")
  return { steps, current, completed: steps.filter((t) => t.status === "done").length, total: steps.length }
}

export function taskDependencies(task: Task, tasks: readonly Task[]): string[] {
  return task.dependsOn.flatMap((id) => {
    const dependency = tasks.find((t) => t.id === id)
    return dependency && dependency.status !== "done" && dependency.status !== "cancelled" ? [dependency.title] : []
  })
}

export function taskText(text: string, members: readonly Pick<Member, "slug" | "name">[]): string {
  return text.replace(/(^|[\s(])@([a-z0-9-]+)\b/g, (_, prefix: string, slug: string) => `${prefix}${members.find((m) => m.slug === slug)?.name ?? `@${slug}`}`)
}

export function taskOwner(task: Pick<Task, "owner">, members: readonly Pick<Member, "slug" | "name">[], agents: readonly Pick<Agent, "slug" | "name">[] = []) {
  if (!task.owner) return { name: "Unassigned" }
  const known = members.find((m) => m.slug === task.owner) ?? agents.find((a) => a.slug === task.owner)
  return { slug: task.owner, name: known?.name ?? "Former agent" }
}
