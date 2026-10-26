import type { HumanAsk, LifeLine, Task, WorkerRow } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { deskTasks, fileTiles, helperLabel, helpers, knowns, nowProgress, waiting } from "./desk-model"

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
const worker = (id: string, status: WorkerRow["status"], startedAt: number): WorkerRow => ({
  id,
  task: id,
  status,
  step: status === "running" ? "reading" : null,
  steps: 1,
  startedAt,
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

  it("lists running helpers before finished ones", () => {
    const sorted = helpers([worker("old", "done", 1), worker("new", "running", 2), worker("older", "failed", 0)])
    expect(sorted.map((w) => w.id)).toEqual(["new", "old", "older"])
    expect(helperLabel(sorted[0]!)).toBe("reading")
    expect(helperLabel(sorted[1]!)).toBe("done")
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
