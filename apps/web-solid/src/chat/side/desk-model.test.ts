import type { HumanAsk, LifeLine, Task } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { deskMode, deskTasks, fileTiles, knowns, nowProgress, taskMark, tasksLine, waiting } from "./desk-model"

const task = (id: string, status: Task["status"]) => ({ id, title: id, status, dependsOn: [] }) as unknown as Task
const line = (pos: number, extra: Partial<LifeLine> = {}): LifeLine => ({
  pos,
  at: 0,
  text: `fact ${pos}`,
  source: "you",
  pinned: false,
  redacted: false,
  ...extra,
})
describe("desk model", () => {
  it("shows the newest files first and counts the rest", () => {
    const tiles = fileTiles([1, 2, 3, 4, 5, 6])
    expect(tiles.shown).toEqual([6, 5, 4, 3])
    expect(tiles.more).toBe(2)
    expect(fileTiles([1]).more).toBe(0)
  })

  it("puts running tasks first, counts only non-cancelled steps and caps the list", () => {
    const desk = deskTasks([
      task("a", "done"),
      task("b", "todo"),
      task("c", "doing"),
      task("x", "cancelled"),
      task("d", "blocked"),
      task("e", "todo"),
      task("f", "todo"),
    ])
    expect(desk.shown.map((t) => t.id)).toEqual(["c", "d", "b", "e", "f"])
    expect(desk.completed).toBe(1)
    expect(desk.total).toBe(6)
    expect(desk.more).toBe(1)
  })

  it("reports progress only while a plan is unfinished", () => {
    expect(nowProgress([])).toBeNull()
    expect(nowProgress([task("a", "done"), task("b", "doing")])).toBe(0.5)
    expect(nowProgress([task("a", "done")])).toBeNull()
  })

  it("offers an ask's options as choices unless it is a form", () => {
    const simple = { id: "1", from: "kiko", text: "Book it?", options: ["Approve", "Skip", "Later", "More"] }
    const form = { id: "2", from: "kiko", text: "Details", questions: [{ id: "q" }], options: ["Yes"] }
    const [a, b] = waiting([simple, form] as unknown as HumanAsk[])
    expect(a?.choices).toEqual(["Approve", "Skip", "Later"])
    expect(b?.choices).toEqual([])
  })

  it("marks each task by what it is doing", () => {
    const none = new Set<string>()
    expect(taskMark({ status: "todo" }, none)).toBe("todo")
    expect(taskMark({ status: "doing" }, none)).toBe("doing")
    expect(taskMark({ status: "review" }, none)).toBe("partial")
    expect(taskMark({ status: "done" }, none)).toBe("done")
    expect(taskMark({ status: "blocked" }, none)).toBe("waiting")
  })

  it("marks a running task as waiting on you while its owner has an open question", () => {
    expect(taskMark({ status: "doing", owner: "kiko" } as Task, new Set(["kiko"]))).toBe("waiting")
    expect(taskMark({ status: "doing", owner: "kiko" } as Task, new Set(["alpha"]))).toBe("doing")
    expect(taskMark({ status: "done", owner: "kiko" } as Task, new Set(["kiko"]))).toBe("done")
  })

  it("is working while anything runs, waits on you, or a helper works, and done otherwise", () => {
    const quiet = { running: false, tasks: [task("a", "done")], lanes: [{ state: "done" as const }], asks: 0 }
    expect(deskMode(quiet)).toBe("done")
    expect(deskMode({ ...quiet, running: true })).toBe("working")
    expect(deskMode({ ...quiet, asks: 1 })).toBe("working")
    expect(deskMode({ ...quiet, lanes: [{ state: "working" }] })).toBe("working")
    expect(deskMode({ ...quiet, tasks: [task("a", "doing")] })).toBe("working")
    expect(deskMode({ ...quiet, lanes: [{ state: "failed" }, { state: "stopped" }] })).toBe("done")
  })

  it("folds finished tasks into one line", () => {
    expect(tasksLine([])).toBe("No tasks")
    expect(tasksLine([task("a", "done")])).toBe("The task is done")
    expect(tasksLine([task("a", "done"), task("b", "done"), task("c", "cancelled")])).toBe("All 2 tasks done")
    expect(tasksLine([task("a", "done"), task("b", "todo")])).toBe("1 of 2 tasks done")
  })

  it("keeps pinned, live memory facts first and skips redacted or replaced ones", () => {
    const { shown, more } = knowns([
      line(1),
      line(2, { pinned: true }),
      line(3, { redacted: true }),
      line(4, { supersededBy: 5 }),
      ...[5, 6, 7, 8, 9, 10, 11].map((n) => line(n)),
    ])
    expect(shown[0]?.pos).toBe(2)
    expect(shown.map((l) => l.pos)).not.toContain(3)
    expect(shown.map((l) => l.pos)).not.toContain(4)
    expect(shown).toHaveLength(6)
    expect(more).toBe(3)
  })
})
