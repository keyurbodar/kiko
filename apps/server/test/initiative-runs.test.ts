import { expect, test } from "bun:test"
import { INITIATIVE_WAKEUP, InitiativeEngine, type Level, type WakeInput } from "../src/initiative/engine"
import type { WakeResult } from "../src/room/wake"
import { sqlWith } from "./sql-shim"
import { USER_STEPS } from "../src/user/schema"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 16, 13)

type Task = { id: string; title: string; status: string; owner?: string; updatedAt: number }

function world(opts: { level?: Level; hidden?: string[] } = {}) {
  const sql = sqlWith(USER_STEPS)
  const wakes: { room: string; input: WakeInput }[] = []
  const armed: (number | null)[] = []
  const counts: Record<string, number> = {}
  const hidden = new Set(opts.hidden ?? [])
  let answer: WakeResult | "busy" = "delivered"
  const engine = new InitiativeEngine({
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
    setWakeup: async (at) => void armed.push(at),
    clearWakeup: async () => void armed.push(null),
  })
  /** What RoomDO pushes to `UserDO.chatTasks` when a chat's board changes. */
  const board = (room: string, tasks: Task[]) => {
    sql.exec("INSERT OR REPLACE INTO chat_tasks (room_id, tasks) VALUES (?, ?)", room, JSON.stringify({ open: tasks.length, oldest: tasks }))
  }
  const task = (id: string, updatedAt: number, extra: Partial<Task> = {}): Task => ({ id, title: `task ${id}`, status: "open", updatedAt, ...extra })
  return { sql, engine, wakes, armed, counts, board, task, answer: (a: WakeResult | "busy") => void (answer = a) }
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

test("a wake that is busy, gone or refused is tried again in an hour, not a day", async () => {
  for (const result of ["busy", "gone", "refused"] as const) {
    const { board, task, engine, wakes, armed, answer } = world()
    board("r1", [task("t1", NOW - DAY)])
    answer(result)
    const first = await engine.pass(NOW)
    expect(first.retryAt).toBe(NOW + HOUR)
    expect(armed.at(-1)).toBe(NOW + HOUR)
    expect(await engine.arm(NOW + 1_000)).toBe(NOW + HOUR)
    answer("delivered")
    await engine.pass(NOW + HOUR)
    expect(wakes.length).toBe(2)
    expect(wakes[1]!.input.id).toBe(wakes[0]!.input.id)
    expect(armed.at(-1)! - (NOW + HOUR)).toBeGreaterThan(HOUR)
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

test("the daily pass runs at nine in the owner's time zone", async () => {
  const { engine, armed } = world()
  expect(await engine.arm(Date.UTC(2026, 9, 16, 10))).toBe(Date.UTC(2026, 9, 17, 9))
  expect(armed.at(-1)).toBe(Date.UTC(2026, 9, 17, 9))
})

test("levels off and chat never wake a chat and arm no pass", async () => {
  for (const level of ["off", "chat"] as const) {
    const { board, task, engine, wakes, armed } = world({ level })
    board("r1", [task("t1", NOW - DAY)])
    await engine.pass(NOW)
    expect(wakes.length).toBe(0)
    expect(armed.at(-1)).toBeNull()
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
