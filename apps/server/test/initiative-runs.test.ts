import { expect, test } from "bun:test"
import { InitiativeEngine, type Level, type WakeInput } from "../src/initiative/engine"
import type { WakeResult } from "../src/room/delivery"
import { sqlWith } from "./sql-shim"
import { OWNER_STEPS } from "../src/owner/schema"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 16, 13)

type Task = { id: string; title: string; status: string; owner?: string; updatedAt: number }

function world(opts: { level?: Level; hidden?: string[] } = {}) {
  const sql = sqlWith(OWNER_STEPS)
  const wakes: { room: string; input: WakeInput }[] = []
  const counts: Record<string, number> = {}
  const hidden = new Set(opts.hidden ?? [])
  let answer: WakeResult | "busy" = "delivered"
  const boards = new Map<string, Task[]>()
  const engine = new InitiativeEngine({
    boards: () => [...boards].map(([roomId, oldest]) => ({ roomId, oldest })),
    sql,
    tz: () => "UTC",
    level: () => opts.level ?? "digest",
    title: (id) => (hidden.has(id) ? null : id),
    wake: async (room, input) => {
      wakes.push({ room, input })
      return answer
    },
    count: (delta) => {
      for (const [k, n] of Object.entries(delta)) counts[k] = (counts[k] ?? 0) + n
    },
  })
  const board = (room: string, tasks: Task[]) => {
    boards.set(room, tasks)
  }
  const task = (id: string, updatedAt: number, extra: Partial<Task> = {}): Task => ({ id, title: `task ${id}`, status: "open", updatedAt, ...extra })
  return { sql, engine, wakes, counts, board, task, answer: (a: WakeResult | "busy") => void (answer = a) }
}

test("the pass wakes the chat's lead about its oldest open task, and no other", async () => {
  const { board, task, engine, wakes, counts } = world()
  board("r1", [task("t1", NOW - 2 * DAY)])
  board("r2", [task("t2", NOW - 5 * DAY)])
  board("r3", [task("t3", NOW - DAY)])
  const report = await engine.pass(NOW)
  expect(wakes.length).toBe(1)
  expect(wakes[0]!.room).toBe("r2")
  expect(wakes[0]!.input.to).toBeNull()
  expect(wakes[0]!.input.body).toContain("t2")
  expect(report.woke.map((w) => w.result)).toEqual(["delivered"])
  expect(counts.initiative_woke).toBe(1)
})

test("a chat that is private or gone is skipped", async () => {
  const { board, task, engine, wakes } = world({ hidden: ["r1"] })
  board("r1", [task("t1", NOW - 5 * DAY)])
  board("r2", [task("t2", NOW - DAY)])
  await engine.pass(NOW)
  expect(wakes.map((w) => w.room)).toEqual(["r2"])
})

test("a wake that is busy, gone or refused waits for the next human-triggered pass, with no retry of its own", async () => {
  for (const result of ["busy", "gone", "refused"] as const) {
    const { board, task, engine, wakes, answer } = world()
    board("r1", [task("t1", NOW - DAY)])
    answer(result)
    const first = await engine.pass(NOW)
    expect(first.woke.map((w) => w.result)).toEqual([result])
    // Nothing landed, so nothing is recorded and no later pass is scheduled: only a human reply runs another.
    expect(wakes.length).toBe(1)
    answer("delivered")
    await engine.pass(NOW + HOUR)
    expect(wakes.length).toBe(2)
    expect(wakes[1]!.input.id).toBe(wakes[0]!.input.id)
  }
})

test("a task raised in the last three days waits, and the next oldest goes first", async () => {
  const { board, task, engine, wakes } = world()
  board("r1", [task("t1", NOW - 5 * DAY), task("t2", NOW - 4 * DAY)])
  await engine.pass(NOW)
  // The board reports its oldest row, so the next one gets its turn once t1 is inside the window.
  board("r1", [task("t2", NOW - 4 * DAY)])
  await engine.pass(NOW + DAY)
  expect(wakes.map((w) => w.input.body.match(/t\d/)?.[0])).toEqual(["t1", "t2"])
})

test("the same task is raised again once the three days pass", async () => {
  const { board, task, engine, wakes } = world()
  board("r1", [task("t1", NOW - 5 * DAY)])
  await engine.pass(NOW)
  await engine.pass(NOW + 2 * DAY)
  expect(wakes.length).toBe(1)
  await engine.pass(NOW + 3 * DAY + HOUR)
  expect(wakes.length).toBe(2)
})

test("levels off and chat never wake a chat", async () => {
  for (const level of ["off", "chat"] as const) {
    const { board, task, engine, wakes } = world({ level })
    board("r1", [task("t1", NOW - DAY)])
    await engine.pass(NOW)
    expect(wakes.length).toBe(0)
  }
})

test("a task with an owner is raised with that agent", async () => {
  const { board, task, engine, wakes } = world()
  board("r1", [task("t1", NOW - DAY, { owner: "ada" })])
  await engine.pass(NOW)
  expect(wakes[0]!.input.to).toBe("ada")
  expect(wakes[0]!.input.body).toContain("update_task")
})

test("active raises more per pass than digest", async () => {
  for (const [level, want] of [["digest", 1], ["active", 3]] as const) {
    const { board, task, engine, wakes } = world({ level })
    for (const room of ["r1", "r2", "r3", "r4"]) board(room, [task(`${room}t`, NOW - DAY)])
    await engine.pass(NOW)
    expect(wakes.length).toBe(want)
  }
})

test("a wake id names the task and the day, so a later pass the same day adds nothing", async () => {
  const { board, task, engine, wakes } = world()
  board("r1", [task("t1", NOW - DAY)])
  await engine.pass(NOW)
  await engine.pass(NOW + HOUR)
  expect(wakes.length).toBe(1)
  expect(wakes[0]!.input.id.startsWith("task:r1:t1#")).toBe(true)
  expect(wakes[0]!.input.reason).toContain("Not touched since")
})
