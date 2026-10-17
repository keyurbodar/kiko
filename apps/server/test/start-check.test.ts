import { expect, test } from "bun:test"
import type { Alarms } from "@kiko/durable/alarm"
import type { AgentSlug } from "@kiko/protocol"
import { START_WITHIN_MS, StartCheck } from "../src/room/start-check"
import { sqlStorage } from "./sql-shim"

const ada = "ada" as AgentSlug

function setup(idle = true) {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const wakeups = new Map<string, number>()
  const alarms = { setWakeup: async (k: string, at: number) => void wakeups.set(k, at), clearWakeup: async (k: string) => void wakeups.delete(k) } as unknown as Alarms
  const reports: { slug: string; inputs: readonly string[]; key: string }[] = []
  const check = new StartCheck({ sql, alarms, idle: () => idle, report: (slug, inputs, key) => reports.push({ slug, inputs, key }) })
  return { check, reports, wakeups }
}

test("an idle agent that never starts on a message is reported once, with the messages to retry", async () => {
  const { check, reports, wakeups } = setup()
  await check.arm(ada, ["m1", "m2"], 0)
  expect(wakeups.get("start-check")).toBe(START_WITHIN_MS)
  await check.due(START_WITHIN_MS - 1)
  expect(reports).toEqual([])
  await check.due(START_WITHIN_MS)
  await check.due(START_WITHIN_MS + 5)
  expect(reports).toEqual([{ slug: "ada", inputs: ["m1", "m2"], key: `not-started:ada:${START_WITHIN_MS}` }])
  expect(wakeups.has("start-check")).toBe(false)
})

test("a run that starts clears the check", async () => {
  const { check, reports } = setup()
  await check.arm(ada, ["m1"], 0)
  check.started(ada)
  await check.due(START_WITHIN_MS * 2)
  expect(reports).toEqual([])
})

test("an agent that is busy when the check is due started, so nothing is reported", async () => {
  const { check, reports } = setup(false)
  await check.arm(ada, ["m1"], 0)
  await check.due(START_WITHIN_MS)
  expect(reports).toEqual([])
})
