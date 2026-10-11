import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import type { Envelope } from "@yuki/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import type { Received } from "./fake-agent"

setDefaultTimeout(30_000)
let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./wake-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      USER: { className: "UserDO", useSQLite: true },
      ROOM: { className: "RoomDO", useSQLite: true },
      AGENT: { className: "FakeAgent", useSQLite: true },
    },
    r2Buckets: ["FILES"],
  })
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
}, 20_000)

let n = 0
const ROOM = "01J0000000000000000000000W"
const soon = (ms: number) => new Date(Date.now() + ms).toISOString()

async function post(path: string, body?: unknown): Promise<any> {
  const res = await mf.dispatchFetch(`http://do${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${path} answered ${res.status}: ${text.slice(0, 300)}`)
  }
}
const rpc = async (user: string, method: string, ...args: unknown[]) => (await post(`/user/${user}`, { method, args })).result
const say = (user: string, text: string) => post(`/say/${user}/${ROOM}`, { text })
const received = async (user: string): Promise<Envelope[]> => ((await post(`/calls/${user}/${ROOM}/yuki`)) as { received: Received[] }).received.flatMap((r) => r.envelopes)
const wakes = async (user: string, prefix: string) => (await received(user)).filter((e) => e.id.startsWith(prefix))

async function until<T>(what: string, check: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value !== undefined && value !== false) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function userWithChat(): Promise<string> {
  const user = `wake${++n}`
  await rpc(user, "createChat", ROOM, "wakes")
  await post(`/adopt/${user}/${ROOM}`)
  return user
}

async function humanSays(user: string, text: string): Promise<void> {
  await say(user, text)
  await until(`the burst "${text}"`, async () => (await received(user)).some((e) => e.body.includes(text)))
}

test("an agent reminder held by the user's budget reaches the agent once the human is back", async () => {
  const user = await userWithChat()
  await rpc(user, "setLimits", { autonomousRunsPerDay: 0 })
  await rpc(user, "createReminder", user, { text: "check the build", time: soon(500), tz: "UTC", roomId: ROOM, target: "yuki" })
  await until("the reminder to fire", async () => (await rpc(user, "listReminders"))[0].status === "done")
  await new Promise((r) => setTimeout(r, 500))
  expect(await wakes(user, "reminder:")).toEqual([])
  await rpc(user, "setLimits", { autonomousRunsPerDay: 100 })
  await humanSays(user, "i am back")
  const [wake] = await until("the held reminder", async () => {
    const got = await wakes(user, "reminder:")
    return got.length ? got : undefined
  })
  expect(wake!.body).toBe("reminder: check the build")
  await new Promise((r) => setTimeout(r, 500))
  expect((await wakes(user, "reminder:")).length).toBe(1)
})

test("a task wake held by the user's budget is not lost: it is delivered once the human is back", async () => {
  const user = await userWithChat()
  await humanSays(user, "plan it")
  await rpc(user, "setLimits", { autonomousRunsPerDay: 0 })
  const task = (call: unknown) => post(`/task/${user}/${ROOM}/yuki`, call)
  expect((await task({ op: "create_task", id: "a", title: "first", owner: "yuki" })).ok).toBe(true)
  expect((await task({ op: "create_task", id: "b", title: "second", owner: "yuki", dependsOn: ["a"] })).ok).toBe(true)
  expect((await task({ op: "update_task", id: "a", status: "done" })).ok).toBe(true)
  await new Promise((r) => setTimeout(r, 800))
  expect(await wakes(user, "unblocked:")).toEqual([])
  await rpc(user, "setLimits", { autonomousRunsPerDay: 100 })
  await humanSays(user, "go on")
  const got = await until("the held task wake", async () => {
    const w = await wakes(user, "unblocked:")
    return w.length ? w : undefined
  })
  expect(got.map((e) => e.id)).toEqual(["unblocked:b"])
})

test("a run the agent refused gives its budget back", async () => {
  const user = await userWithChat()
  await rpc(user, "setLimits", { autonomousRunsPerDay: 1 })
  const made = await rpc(user, "createRoutine", user, { name: "tick", instructions: "say tick", trigger: { on: "task" }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  expect(made.ok).toBe(true)
  await post(`/refuse/${user}/${ROOM}/yuki/1`)
  expect(await rpc(user, "runRoutine", made.routine.id)).toBe("refused")
  expect(await rpc(user, "runRoutine", made.routine.id)).toBe("delivered")
  expect((await wakes(user, "routine:")).length).toBe(1)
})

test("a reminder an agent made on the human's chain wakes it as the human's run", async () => {
  const user = await userWithChat()
  const chain = { rootId: "m-human", hop: 0, origin: "human" }
  const made = await rpc(user, "createReminder", user, { text: "send the file", time: soon(400), tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "yuki", chain })
  expect(made.ok).toBe(true)
  const [wake] = await until("the reminder wake", async () => {
    const got = await wakes(user, "reminder:")
    return got.length ? got : undefined
  })
  expect(wake).toMatchObject({ rootId: "m-human", origin: "human" })
})

const room = async (user: string, method: string, ...args: unknown[]) => (await post(`/room/${user}/${ROOM}`, { method, args })).result

async function tickRoutine(user: string): Promise<string> {
  const made = await rpc(user, "createRoutine", user, { name: "tick", instructions: "say tick", trigger: { on: "task" }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  expect(made.ok).toBe(true)
  return made.routine.id
}

async function run(user: string, id: string, say?: string): Promise<void> {
  await room(user, "setStatus", "yuki", "working")
  if (say) expect(await room(user, "post", "yuki", id, 0, 0, say)).toBe(true)
  await room(user, "endRun", "yuki", id)
}

test("a routine result lost on its way to UserDO is sent again, so the run does not stay running", async () => {
  const user = await userWithChat()
  const id = await tickRoutine(user)
  expect(await rpc(user, "runRoutine", id)).toBe("delivered")
  await rpc(user, "loseResults", 1)
  await run(user, "run-1", "tick")
  const done = await until("the run's result", async () => (await rpc(user, "routineRuns", id)).find((r: { status: string }) => r.status !== "running"))
  expect(done.status).toBe("ok")
})

test("what an earlier run posts after a routine was handed over does not count as the routine's answer", async () => {
  const user = await userWithChat()
  const id = await tickRoutine(user)
  await room(user, "setStatus", "yuki", "working")
  expect(await rpc(user, "runRoutine", id)).toBe("delivered")
  expect(await room(user, "post", "yuki", "run-a", 0, 0, "still on the earlier question")).toBe(true)
  await room(user, "endRun", "yuki", "run-a")
  await run(user, "run-b")
  const done = await until("the run's result", async () => (await rpc(user, "routineRuns", id)).find((r: { status: string }) => r.status !== "running"))
  expect(done.status).toBe("quiet")
})

test("a held reminder is followed when it is delivered later, so its run can keep the promise", async () => {
  const user = await userWithChat()
  await rpc(user, "setLimits", { autonomousRunsPerDay: 0 })
  await rpc(user, "createReminder", user, { text: "send the summary", time: soon(400), tz: "UTC", roomId: ROOM, target: "yuki" })
  await until("the reminder to fire", async () => (await rpc(user, "listReminders"))[0].status === "done")
  expect(await room(user, "followed")).toEqual([])
  await rpc(user, "setLimits", { autonomousRunsPerDay: 100 })
  await humanSays(user, "i am back")
  await until("the held reminder", async () => (await wakes(user, "reminder:")).length > 0)
  expect((await room(user, "followed")).map((r: { routineId: string }) => r.routineId)).toEqual(["reminder"])
})

test("one held wake that fails to arrive does not stop the others", async () => {
  const user = await userWithChat()
  await rpc(user, "setLimits", { autonomousRunsPerDay: 0 })
  await rpc(user, "createReminder", user, { text: "first", time: soon(300), tz: "UTC", roomId: ROOM, target: "yuki" })
  await rpc(user, "createReminder", user, { text: "second", time: soon(300), tz: "UTC", roomId: ROOM, target: "yuki" })
  await until("both reminders to fire", async () => (await rpc(user, "listReminders")).every((r: { status: string }) => r.status === "done"))
  await rpc(user, "setLimits", { autonomousRunsPerDay: 100 })
  await post(`/fail/${user}/${ROOM}/yuki/1`)
  await room(user, "retryHeld")
  expect((await wakes(user, "reminder:")).length).toBe(1)
})
