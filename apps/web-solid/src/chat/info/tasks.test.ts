import { expect, test } from "bun:test"
import { groupTasks } from "./tasks"
import { openTasks } from "./tasks-model"

test("tasks group by status, doing first, and only open ones count", () => {
  const t = (id: string, status: "todo" | "doing" | "done" | "blocked") => ({ id, title: id, status, dependsOn: [] })
  const tasks = [t("a", "done"), t("b", "todo"), t("c", "doing"), t("d", "blocked")]
  expect(groupTasks(tasks).map((g) => g.status)).toEqual(["doing", "blocked", "todo", "done"])
  expect(openTasks(tasks).map((x) => x.id)).toEqual(["b", "c", "d"])
})
