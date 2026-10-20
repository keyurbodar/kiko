import { writeFile } from "node:fs/promises"
import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle, Session, Verifier } from "../client"
import { VerifyError } from "../client"
import { messages, newRoom, poll } from "../kit"
import type { Suite } from "../runner"
import { fake, readStats, resetStats } from "./latency"

// PR2 measures physical OWNER SQL writes. Legacy object counters remain in baseline evidence.
// KIKO_JOURNAL_QUIET_MS can shorten a smoke run, but a gate requires the full minute.
const QUIET_MS = Number(process.env.KIKO_JOURNAL_QUIET_MS ?? 60_000)
const BASELINE = process.env.PR2_BASELINE === "1" || process.env.PR1_BASELINE === "1"
const EVIDENCE = process.env.PR2_EVIDENCE ?? process.env.PR1_EVIDENCE
const ROW_GATE = 8
const WARM_RUNS = 5
const AGENT = "kiko"

type Counters = Record<string, number>
type AlarmAt = number | null | undefined
type Phase = {
  name: string
  counters: Counters
  interObjectCalls: number
  rowsWritten: { total: number; byObject: Record<string, number> }
  alarms: { setAlarm: { total: number; byObject: Record<string, number> }; armedAgent: AlarmAt }
}
type Evidence = {
  measuredAt: string
  server: string
  baseline: boolean
  quietMs: number
  agent: string
  phases: Phase[]
  warmPrompts: Phase[]
  warmMedian: { total: number; byObject: Record<string, number> }
  errors: { liveRows: number; persistedRows: number }
}

const KIND_PARTS = ["owner", "agent", "room", "user", "file"] as const

const sum = (c: Counters, test: (key: string) => boolean): number =>
  Object.entries(c).reduce((n, [k, v]) => (test(k) ? n + v : n), 0)

export const rowsWritten = (c: Counters): number => c["owner.rowsWritten"] ?? sum(c, (k) => k.endsWith(".rowsWritten"))
export const interObjectCalls = (c: Counters): number => sum(c, (k) => k.startsWith("rpc.") && k !== "rpc.owner" && !k.startsWith("rpc.owner."))
const setAlarm = (c: Counters): number => c["owner.kv.setAlarm"] ?? sum(c, (k) => k.endsWith(".kv.setAlarm"))

/** Rows and alarm calls per object, so a room's own background alarm is never read as the agent's. */
function byObject(c: Counters, suffix: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const kind of KIND_PARTS) out[kind] = c[`${kind}.${suffix}`] ?? 0
  return out
}

const errorRows = (room: RoomHandle) => messages(room).filter((m) => m.event?.kind === "run_error")

/**
 * The error rows the room persisted, read back over a fresh socket from seq 0. The live channel could have
 * missed one, or counted one twice; this is what a reopening tab sees.
 */
async function persistedErrorRows(s: Session, roomId: string): Promise<number> {
  const room = await s.room(roomId)
  try {
    await room.expect((f) => f.t === "events" || f.t === "reset")
    return errorRows(room).length
  } finally {
    room.raw.close()
  }
}

const isIdle = (f: RoomToClient) => f.t === "status" && f.state === "idle"

async function waitIdle(room: RoomHandle, ms = 60_000): Promise<void> {
  await room.expect(isIdle, ms)
}

async function callJson(v: Verifier, s: Session, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(new URL(path, v.url), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: s.auth },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new VerifyError(`${path} answered ${res.status}. start the Worker with NODE_ENV=development`)
  return res.json()
}

/**
 * The agent's actual alarm from `AgentDO.status().alarmAt`, not the count of `setAlarm` calls: an alarm
 * already set for the same time is skipped, so the count alone cannot say one is armed.
 */
async function armedAlarm(v: Verifier, s: Session, roomId: string): Promise<AlarmAt> {
  const body = (await callJson(v, s, "api/dev/agent/status", { roomId, slug: AGENT })) as { alarmAt?: unknown }
  if (body.alarmAt === null || typeof body.alarmAt === "number") return body.alarmAt
  return undefined
}

const describeAlarm = (at: AlarmAt): string =>
  at === undefined ? "unknown (the dev status has no alarmAt)" : at === null ? "none armed" : `armed for ${new Date(at).toISOString()}`

function report(label: string, p: Phase): void {
  const rows = p.rowsWritten.byObject
  const alarms = p.alarms.setAlarm.byObject
  const kv = Object.fromEntries(
    KIND_PARTS.map((kind) => [
      kind,
      `setAlarm ${p.alarms.setAlarm.byObject[kind]}, put ${p.counters[`${kind}.kv.put`] ?? 0}, delete ${p.counters[`${kind}.kv.delete`] ?? 0}`,
    ]),
  )
  console.log(
    `  ${label}: ${p.rowsWritten.total} rows written (owner ${rows.owner}, agent ${rows.agent}, room ${rows.room}, user ${rows.user}), ` +
      `${p.alarms.setAlarm.total} setAlarm calls [${KIND_PARTS.map((k) => `${k} ${alarms[k]}`).join(", ")}], ` +
      `agent alarm ${describeAlarm(p.alarms.armedAgent)}`,
  )
  console.log(`    kv by object: ${KIND_PARTS.map((k) => `${k} [${kv[k]}]`).join("; ")}`)
}

/** Resets, waits the quiet period, then reads the counters and the agent's alarm state at the end of it. */
async function measure(v: Verifier, s: Session, name: string, roomId: string): Promise<Phase> {
  await resetStats(v, s)
  await Bun.sleep(QUIET_MS)
  return turn(v, s, name, roomId)
}

/** Reads the counters now: the measured turn, or the end of a quiet wait. */
async function turn(v: Verifier, s: Session, name: string, roomId: string): Promise<Phase> {
  const counters = await readStats(v, s)
  const phase: Phase = {
    name,
    counters,
    interObjectCalls: interObjectCalls(counters),
    rowsWritten: { total: rowsWritten(counters), byObject: byObject(counters, "rowsWritten") },
    alarms: {
      setAlarm: { total: setAlarm(counters), byObject: byObject(counters, "kv.setAlarm") },
      armedAgent: await armedAlarm(v, s, roomId),
    },
  }
  report(name, phase)
  return phase
}

function gate(ok: boolean, message: string): void {
  if (!ok && !BASELINE) throw new VerifyError(message)
}

const suite: Suite = {
  name: "journal-overhead",
  async run(v) {
    const s = await v.as("journal-overhead")
    const phases: Phase[] = []

    // `[reply]` makes fakeReply answer with exactly the text that follows it, so a poll can match the answer.
    const warmTurn = async (room: RoomHandle, text: string) => {
      const clientId = room.send(`[reply] ${text}`)
      await room.expect({ t: "ack", clientId })
      await poll("the warm answer", () => messages(room).some((m) => m.text === text), 40_000)
      await waitIdle(room)
      await Bun.sleep(1_000)
    }

    const normal = await newRoom(s, "journal overhead")
    await fake(v, s, normal.roomId)
    await warmTurn(normal.room, "warm")

    const warmPrompts: Phase[] = []
    for (let sample = 1; sample <= WARM_RUNS; sample++) {
      await resetStats(v, s)
      const text = `one prompt ${sample}`
      const clientId = normal.room.send(`[reply] ${text}`)
      await normal.room.expect({ t: "ack", clientId })
      await poll("the answer", () => messages(normal.room).some((m) => m.text === text), 40_000)
      await waitIdle(normal.room)
      await Bun.sleep(300)
      warmPrompts.push(await turn(v, s, `warm prompt ${sample}`, normal.roomId))
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
    const warmMedian = {
      total: median(warmPrompts.map((p) => p.rowsWritten.total)),
      byObject: Object.fromEntries(KIND_PARTS.map((kind) => [kind, median(warmPrompts.map((p) => p.rowsWritten.byObject[kind] ?? 0))])),
    }
    phases.push(warmPrompts[WARM_RUNS - 1]!)
    phases.push(await measure(v, s, `quiet minute after the prompt (${QUIET_MS / 1000} s)`, normal.roomId))

    // `[model-error]` makes fakeReply end every request with a model error, so a retry inside the run spends
    // itself and the run still ends in one visible row.
    const failing = await newRoom(s, "journal overhead error")
    await fake(v, s, failing.roomId)
    await warmTurn(failing.room, "warm")

    await resetStats(v, s)
    const errorId = failing.room.send("[model-error] 429 rate limited")
    await failing.room.expect({ t: "ack", clientId: errorId })
    await poll("the error row", () => errorRows(failing.room).length > 0, 60_000)
    await waitIdle(failing.room, 60_000)
    await Bun.sleep(2_000)
    phases.push(await turn(v, s, "always-failing prompt", failing.roomId))
    phases.push(await measure(v, s, `quiet minute after the error (${QUIET_MS / 1000} s)`, failing.roomId))
    // Counted after the minute, so a duplicate error that arrives late still fails the gate.
    const liveErrors = errorRows(failing.room).length
    const persistedErrors = await persistedErrorRows(s, failing.roomId)
    console.log(`    always-failing prompt: ${liveErrors} live error rows, ${persistedErrors} on a fresh socket`)

    const evidence: Evidence = {
      measuredAt: new Date().toISOString(),
      server: v.url,
      baseline: BASELINE,
      quietMs: QUIET_MS,
      agent: AGENT,
      phases,
      warmPrompts,
      warmMedian,
      errors: { liveRows: liveErrors, persistedRows: persistedErrors },
    }
    if (EVIDENCE) {
      await writeFile(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`)
      console.log(`  wrote ${EVIDENCE}`)
    }

    const quietPhases = [phases[1], phases[3]]
    console.log(`  ${BASELINE ? "baseline" : "gate"}: physical rows median ${warmMedian.total}/${ROW_GATE}, inter-object RPC ${warmPrompts.map((p) => p.interObjectCalls).join(", ")}, error rows live ${liveErrors} persisted ${persistedErrors}`)
    gate(QUIET_MS >= 60_000, "the quiet gate requires at least 60 seconds; shorter intervals are smoke runs only")
    gate(warmPrompts.every((p) => "owner.rowsWritten" in p.counters), "physical owner.rowsWritten counters are missing")
    gate(warmMedian.total <= ROW_GATE, `OWNER wrote a median of ${warmMedian.total} rows across ${WARM_RUNS} warm prompts, the gate is ${ROW_GATE}`)
    for (const phase of [...warmPrompts, ...phases]) {
      gate(phase.interObjectCalls === 0, `${phase.name}: ${phase.interObjectCalls} calls between objects`)
    }
    for (const phase of quietPhases) {
      if (!phase) throw new VerifyError("missing quiet measurement")
      gate(phase.rowsWritten.total === 0, `${phase.name}: ${phase.rowsWritten.total} physical rows written`)
      gate(phase.alarms.setAlarm.total === 0, `${phase.name}: ${phase.alarms.setAlarm.total} setAlarm calls`)
      gate(phase.alarms.armedAgent === null, `${phase.name}: ${describeAlarm(phase.alarms.armedAgent)}`)
    }
    gate(liveErrors === 1, `an always-failing prompt showed ${liveErrors} error rows live, the gate is 1`)
    gate(persistedErrors === 1, `an always-failing prompt persisted ${persistedErrors} error rows, the gate is 1`)

    normal.room.raw.close()
    failing.room.raw.close()
  },
}

export default suite
