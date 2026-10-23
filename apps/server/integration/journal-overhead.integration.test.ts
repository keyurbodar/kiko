import type { RoomToClient } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { type Counters, idle, type Owner, type Room, signIn } from "./owner"
import { startLocalWorker } from "./worker"

const QUIET_MS = 60_000
const ROW_GATE = 7
const WARM_RUNS = 5
const AGENT = "kiko"
const KINDS = ["owner", "agent", "room", "user", "file"] as const

type AlarmAt = number | null | undefined

type Phase = {
  name: string
  counters: Counters
  billingVersion: number
  billableWrites: number
  sqlRows: number
  interObjectCalls: number
  setAlarmCalls: number
  armedAgent: AlarmAt
}

const sum = (counters: Counters, matches: (key: string) => boolean): number =>
  Object.entries(counters).reduce((total, [key, value]) => (matches(key) ? total + value : total), 0)

const rowsWritten = (counters: Counters): number =>
  counters["owner.rowsWritten"] ?? sum(counters, (key) => key.endsWith(".rowsWritten"))

const isIdle = (frame: RoomToClient) => frame.t === "status" && frame.state === "idle"

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN

const describeAlarm = (at: AlarmAt): string =>
  at === undefined ? "unknown" : at === null ? "none armed" : `armed for epoch ms ${at}`

async function armedAlarm(owner: Owner, roomId: string): Promise<AlarmAt> {
  const body = (await owner.post("api/dev/agent/status", { roomId, slug: AGENT })) as { alarmAt?: unknown }
  return body.alarmAt === null || typeof body.alarmAt === "number" ? body.alarmAt : undefined
}

async function measure(owner: Owner, name: string, room: Room): Promise<Phase> {
  const { counters, billingVersion = 0 } = await owner.meter()
  const writes = (suffix: string) => sum(counters, (key) => key.endsWith(suffix))
  const sqlRows = rowsWritten(counters)
  const phase: Phase = {
    name,
    counters,
    billingVersion,
    sqlRows,
    billableWrites: sqlRows + writes(".kvKeysPut") + writes(".kvKeysDeleted") + writes(".alarmWrites"),
    interObjectCalls: sum(
      counters,
      (key) => key.startsWith("rpc.") && key !== "rpc.owner" && !key.startsWith("rpc.owner."),
    ),
    setAlarmCalls: counters["owner.kv.setAlarm"] ?? writes(".kv.setAlarm"),
    armedAgent: await armedAlarm(owner, room.roomId),
  }
  const byKind = KINDS.map((kind) => `${kind} ${counters[`${kind}.rowsWritten`] ?? 0}`).join(", ")
  console.log(
    `${name}: billable writes ${phase.billableWrites}, SQL rows ${sqlRows} (${byKind}), setAlarm ${phase.setAlarmCalls}, agent alarm ${describeAlarm(phase.armedAgent)}`,
  )
  return phase
}

async function quietMinute(owner: Owner, name: string, room: Room): Promise<Phase> {
  await owner.post("api/dev/stats/reset", {})
  await idle(QUIET_MS)
  return measure(owner, name, room)
}

async function prompt(room: Room, text: string, settleMs: number): Promise<void> {
  const clientId = room.send(`[reply] ${text}`)
  await room.next((frame) => frame.t === "ack" && frame.clientId === clientId)
  await room.until(() => room.messages().some((message) => message.text === text))
  await room.next(isIdle)
  await idle(settleMs)
}

async function fakeAgentRoom(owner: Owner, title: string): Promise<Room> {
  const room = await owner.newRoom(title)
  await owner.post("api/dev/agent/fake", { roomId: room.roomId })
  await prompt(room, "warm", 1_000)
  return room
}

function expectQuiet(phase: Phase): void {
  expect(phase.billableWrites, `${phase.name}: billable rows written`).toBe(0)
  expect(phase.setAlarmCalls, `${phase.name}: setAlarm calls`).toBe(0)
  expect(phase.armedAgent, `${phase.name}: ${describeAlarm(phase.armedAgent)}`).toBeNull()
}

describe.concurrent("journal overhead", () => {
  it("keeps a warm prompt within the write budget and writes nothing in the quiet minute after it", async () => {
    await using worker = await startLocalWorker()
    await using owner = await signIn(worker.url, "journal-overhead")
    const room = await fakeAgentRoom(owner, "journal overhead")

    const warmPrompts: Phase[] = []
    for (let sample = 1; sample <= WARM_RUNS; sample++) {
      await owner.post("api/dev/stats/reset", {})
      await prompt(room, `one prompt ${sample}`, 300)
      warmPrompts.push(await measure(owner, `warm prompt ${sample}`, room))
    }
    const quiet = await quietMinute(owner, `quiet minute after the prompt (${QUIET_MS / 1000} s)`, room)

    const billable = median(warmPrompts.map((phase) => phase.billableWrites))
    const sqlRows = median(warmPrompts.map((phase) => phase.sqlRows))
    console.log(`gate: billable writes median ${billable}/${ROW_GATE} (SQL ${sqlRows})`)
    for (const phase of warmPrompts) {
      expect(phase.counters, `${phase.name}: physical owner.rowsWritten counter`).toHaveProperty(["owner.rowsWritten"])
      expect(phase.billingVersion, `${phase.name}: KV-key and setAlarm meters`).toBe(1)
    }
    expect(billable, `median billable rows across ${WARM_RUNS} warm prompts (${sqlRows} SQL rows)`).toBeLessThanOrEqual(
      ROW_GATE,
    )
    for (const phase of [...warmPrompts, quiet]) {
      expect(phase.interObjectCalls, `${phase.name}: calls between objects`).toBe(0)
    }
    expectQuiet(quiet)
  })

  it("shows and persists exactly one error row for an always-failing prompt and then stays quiet", async () => {
    await using worker = await startLocalWorker()
    await using owner = await signIn(worker.url, "journal-overhead")
    const room = await fakeAgentRoom(owner, "journal overhead error")

    await owner.post("api/dev/stats/reset", {})
    const clientId = room.send("[model-error] 429 rate limited")
    await room.next((frame) => frame.t === "ack" && frame.clientId === clientId)
    await room.until(() => room.errorRows().length > 0)
    await room.next(isIdle)
    await idle(2_000)
    const failing = await measure(owner, "always-failing prompt", room)
    const quiet = await quietMinute(owner, `quiet minute after the error (${QUIET_MS / 1000} s)`, room)

    const live = room.errorRows().length
    const fresh = await owner.openRoom(room.roomId)
    const persisted = fresh.errorRows().length
    console.log(`always-failing prompt: ${live} live error rows, ${persisted} on a fresh socket`)

    for (const phase of [failing, quiet]) {
      expect(phase.interObjectCalls, `${phase.name}: calls between objects`).toBe(0)
    }
    expectQuiet(quiet)
    expect(live, "error rows shown live").toBe(1)
    expect(persisted, "error rows persisted").toBe(1)
  })
})
