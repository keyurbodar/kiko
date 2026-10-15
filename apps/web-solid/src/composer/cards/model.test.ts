import { expect, test } from "bun:test"
import type { AgentSlug, HumanAsk, Task } from "@kiko/protocol"
import { composerCards } from "./model"
import { taskDependencies, taskProgress, taskText } from "../../chat/info/tasks-model"

const ada = "ada" as AgentSlug
const bob = "bob" as AgentSlug
const asks: HumanAsk[] = [{ id: "q1", from: ada, text: "Which place?", options: ["Café", "Park"], messageId: "m1" as never }, { id: "q2", from: bob, text: "What time?", messageId: "m2" as never }]
const tasks: Task[] = [{ id: "a", title: "Find places", status: "done", owner: ada, dependsOn: [] }, { id: "b", title: "Compare cafés", status: "doing", owner: bob, dependsOn: ["a"] }, { id: "c", title: "Write shortlist", status: "blocked", owner: ada, dependsOn: ["b"] }, { id: "d", title: "Old plan", status: "cancelled", dependsOn: [] }]


test("questions lead the shared stack and an asking agent is not duplicated as working", () => {
  const cards = composerCards(asks, tasks)
  expect(cards.map((c) => c.kind)).toEqual(["ask", "ask", "tasks"])
  expect(cards[0]?.id).toBe("ask:q1")
  expect(cards[1]?.id).toBe("ask:q2")
})

test("routine writing, provider failures and historical creation receipts never become cards", () => {
  expect(composerCards([], [])).toEqual([])
})

test("progress counts completed room tasks, excludes cancelled work and preserves blockers", () => {
  const progress = taskProgress(tasks)
  expect([progress.completed, progress.total, progress.current?.id]).toEqual([1, 3, "b"])
  expect(taskDependencies(tasks[2]!, tasks)).toEqual(["Compare cafés"])
  expect(taskDependencies(tasks[1]!, tasks)).toEqual([])
  expect(composerCards([], tasks.map((t) => ({ ...t, status: "done" })))).toEqual([])
})


test("task labels use known display names without changing email addresses", () => {
  expect(taskText("Report to @ada about john@ada.com and @outside", [{ slug: ada, name: "Priority tracker" }])).toBe("Report to Priority tracker about john@ada.com and @outside")
})
