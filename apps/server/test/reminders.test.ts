import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./reminders-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
    durableObjects: {
      USER: { className: "UserDO", useSQLite: true },
      ROOM: { className: "RoomDO", useSQLite: true },
    },
  })
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
}, 20_000)

let n = 0
const fresh = () => `rem${++n}`
const ROOM = "01J0000000000000000000000R"

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/user/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

async function userWithChat() {
  const user = fresh()
  await rpc(user, "createChat", ROOM, "reminders")
  return user
}

const soon = (ms: number) => new Date(Date.now() + ms).toISOString()

const routine = (at: string, over: Record<string, unknown> = {}) => ({ name: "water", instructions: "remind the human to drink water", trigger: { on: "time", at }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human", ...over })

test("a one-time routine is stored with its time and listed", async () => {
  const user = await userWithChat()
  const at = soon(3_600_000)
  const created = await rpc(user, "createRoutine", user, routine(at))
  expect(created.ok).toBe(true)
  const [listed] = await rpc(user, "listRoutines")
  expect(listed).toMatchObject({ id: created.routine.id, status: "active", trigger: { on: "time", at }, rrule: null })
  expect(listed.dueUtc).toBe(Math.ceil(Date.parse(at) / 1000) * 1000)
}, 20_000)

test("a cancelled routine is cancelled once", async () => {
  const user = await userWithChat()
  const { routine: made } = await rpc(user, "createRoutine", user, routine(soon(3_600_000)))
  expect((await rpc(user, "cancelRoutine", made.id)).routine.status).toBe("cancelled")
  expect((await rpc(user, "cancelRoutine", made.id)).ok).toBe(false)
}, 20_000)

test("create refuses bad input at the edge", async () => {
  const user = await userWithChat()
  const at = soon(60_000)
  const errors = await Promise.all([
    rpc(user, "createRoutine", user, routine(at, { roomId: "01J0000000000000000000000Z" })),
    rpc(user, "createRoutine", user, routine(at, { tz: "Mars/Olympus" })),
    rpc(user, "createRoutine", user, routine("2026-10-02T09:00:00")),
    rpc(user, "createRoutine", user, routine(at, { trigger: { on: "time", at, rrule: "FREQ=SOMETIMES" } })),
    rpc(user, "createRoutine", user, routine(at, { instructions: "  " })),
    rpc(user, "createRoutine", user, routine(at, { trigger: { on: "watch", url: "https://example.com", everyMinutes: 15 } })),
  ])
  expect(errors.map((e) => e.error)).toEqual([
    "unknown chat",
    "unknown time zone",
    "time must include an offset or z",
    "rrule needs FREQ: MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY, or YEARLY",
    "instructions are empty",
    "its watch trigger is no longer supported. give it a time, message, or webhook trigger.",
  ])
  expect((await rpc(user, "createRoutine", "someone-else", routine(at))).error).toBe("wrong owner")
}, 20_000)

test("deleting a chat removes its routines", async () => {
  const user = await userWithChat()
  await rpc(user, "createRoutine", user, routine(soon(3_600_000)))
  await rpc(user, "createRoutine", user, routine(soon(3_600_000), { name: "daily", trigger: { on: "message" } }))
  expect(await rpc(user, "deleteChat", ROOM)).toBe(true)
  expect(await rpc(user, "listRoutines")).toEqual([])
}, 20_000)
