import { expect, test } from "bun:test"
import { taskOwner } from "./tasks-model"
import { groupTasks } from "./tasks-model"
import { openTasks } from "./tasks-model"

test("tasks group by status, doing first, and only open ones count", () => {
  const t = (id: string, status: "todo" | "doing" | "done" | "blocked") => ({ id, title: id, status, dependsOn: [] })
  const tasks = [t("a", "done"), t("b", "todo"), t("c", "doing"), t("d", "blocked")]
  expect(groupTasks(tasks).map((g) => g.status)).toEqual(["doing", "blocked", "todo", "done"])
  expect(openTasks(tasks).map((x) => x.id)).toEqual(["b", "c", "d"])
})


test("task owner chips use the directory after leaving a room and never disappear", () => {
  const owner = "label-sorter" as never
  const agent = { slug: owner, name: "Label Sorter" }
  expect(taskOwner({ owner }, [agent])).toEqual({ slug: owner, name: "Label Sorter" })
  expect(taskOwner({ owner }, [], [agent])).toEqual({ slug: owner, name: "Label Sorter" })
  expect(taskOwner({ owner }, [])).toEqual({ slug: owner, name: "Former agent" })
  expect(taskOwner({}, [])).toEqual({ name: "Unassigned" })
})
