import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"

// The real UserDO and RoomDO in workerd, with real alarms. Each test uses its own user.
let mf: Miniflare

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./reminders-worker.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    external: ["cloudflare:workers"],
  })
  if (!built.success) throw new Error(built.logs.join("\n"))
  mf = new Miniflare({
    modules: true,
    script: await built.outputs[0]!.text(),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
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
const DAY = 86_400_000

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/user/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

async function messages(user: string): Promise<{ text: string; from: unknown }[]> {
  return (await mf.dispatchFetch(`http://do/room/${user}/${ROOM}`)).json() as never
}

async function until<T>(check: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value !== undefined) return value
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function userWithChat() {
  const user = fresh()
  await rpc(user, "createChat", ROOM, "reminders")
  return user
}

const soon = (ms: number) => new Date(Date.now() + ms).toISOString()

test("a one-off reminder posts one message and is done", async () => {
  const user = await userWithChat()
  const created = await rpc(user, "createReminder", user, { text: "drink water", time: soon(1000), tz: "UTC", roomId: ROOM })
  expect(created.ok).toBe(true)
  const done = await until(async () => {
    const [r] = await rpc(user, "listReminders")
    return r.status === "done" ? r : undefined
  })
  expect(done.lastFired).toBe(created.reminder.dueUtc)
  const stored = await messages(user)
  expect(stored.map((m) => [m.text, m.from])).toEqual([["reminder: drink water", { kind: "system", reason: "reminder" }]])
}, 20_000)

test("an alarm repeated after a crash between delivery and the row update posts nothing", async () => {
  const user = await userWithChat()
  const { reminder } = await rpc(user, "createReminder", user, { text: "once", time: soon(800), tz: "UTC", roomId: ROOM })
  await until(async () => ((await rpc(user, "listReminders"))[0].status === "done" ? true : undefined))
  // Put the row back as it was before the update. The alarm fires again for the same occurrence.
  const rewound = await rpc(user, "rewindReminder", reminder.id)
  expect(rewound.reminder).toMatchObject({ status: "active", dueUtc: reminder.dueUtc })
  await until(async () => ((await rpc(user, "listReminders"))[0].status === "done" ? true : undefined))
  expect((await messages(user)).length).toBe(1)
}, 20_000)

test("a daily reminder moves forward one day in its zone and stays active", async () => {
  const user = await userWithChat()
  const { reminder } = await rpc(user, "createReminder", user, {
    text: "stand up",
    time: soon(800),
    tz: "America/New_York",
    rrule: "FREQ=DAILY",
    roomId: ROOM,
  })
  const moved = await until(async () => {
    const [r] = await rpc(user, "listReminders")
    return r.lastFired !== null ? r : undefined
  })
  expect(moved).toMatchObject({ status: "active", lastFired: reminder.dueUtc })
  // ASSUMPTION in the test: no daylight change in New York within the next day.
  expect(moved.dueUtc).toBe(reminder.dueUtc + DAY)
  expect((await messages(user)).length).toBe(1)
}, 20_000)

test("a cancelled reminder never posts", async () => {
  const user = await userWithChat()
  const { reminder } = await rpc(user, "createReminder", user, { text: "never", time: soon(600), tz: "UTC", roomId: ROOM })
  expect((await rpc(user, "cancelReminder", reminder.id)).reminder.status).toBe("cancelled")
  await new Promise((r) => setTimeout(r, 1500))
  expect(await messages(user)).toEqual([])
  expect((await rpc(user, "cancelReminder", reminder.id)).ok).toBe(false)
}, 20_000)

test("snooze moves a done reminder and it posts again", async () => {
  const user = await userWithChat()
  const { reminder } = await rpc(user, "createReminder", user, { text: "later", time: soon(500), tz: "UTC", roomId: ROOM })
  await until(async () => ((await rpc(user, "listReminders"))[0].status === "done" ? true : undefined))
  const snoozed = await rpc(user, "snoozeReminder", reminder.id, soon(500))
  expect(snoozed.reminder.status).toBe("active")
  await until(async () => ((await messages(user)).length === 2 ? true : undefined))
}, 20_000)

test("create refuses bad input at the edge", async () => {
  const user = await userWithChat()
  const base = { text: "x", time: soon(60_000), tz: "UTC", roomId: ROOM }
  const errors = await Promise.all([
    rpc(user, "createReminder", user, { ...base, roomId: "01J0000000000000000000000Z" }),
    rpc(user, "createReminder", user, { ...base, tz: "Mars/Olympus" }),
    rpc(user, "createReminder", user, { ...base, time: "2026-10-02T09:00:00" }),
    rpc(user, "createReminder", user, { ...base, rrule: "FREQ=SOMETIMES" }),
    rpc(user, "createReminder", user, { ...base, text: "  " }),
  ])
  expect(errors.map((e) => e.error)).toEqual([
    "unknown chat",
    "unknown time zone",
    "time must include an offset or z",
    "rrule does not parse",
    "text is empty",
  ])
  expect((await rpc(user, "createReminder", "someone-else", base)).error).toBe("wrong owner")
}, 20_000)
