import { writeFile } from "node:fs/promises"
import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle, Session, Verifier } from "../client"
import { VerifyError } from "../client"
import { messages, newRoom, poll } from "../kit"
import type { Suite } from "../runner"
import { fake, readStats, resetStats } from "./latency"

// PR 1's gate, measured on a running dev Worker:
// - at most 30 AgentDO rows per warm prompt, median of five
// - no armed alarm on the agent 1 minute after a run
// - an agent whose model always throws shows one error row and holds no alarm a minute later
//
// `PR1_BASELINE=1` records the same numbers on `main` and asserts nothing, so the before and after columns
// come from one command. `PR1_EVIDENCE=<path>` writes the raw counters to that file; it holds counts, ids and
// alarm times, never a token. `KIKO_JOURNAL_QUIET_MS` shortens the minute for a smoke run, which is not a
// gate measurement.

const QUIET_MS = Number(process.env.KIKO_JOURNAL_QUIET_MS ?? 60_000)
const BASELINE = process.env.PR1_BASELINE === "1"
const EVIDENCE = process.env.PR1_EVIDENCE
const ROW_GATE = 30
const WARM_RUNS = 5
const AGENT = "kiko"

type Counters = Record<string, number>
type AlarmAt = number | null | undefined
type Phase = {
  name: string
  counters: Counters
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

const KIND_PARTS = ["agent", "room", "user", "file"] as const

const sum = (c: Counters, test: (key: string) => boolean): number =>
  Object.entries(c).reduce((n, [k, v]) => (test(k) ? n + v : n), 0)

const rowsWritten = (c: Counters): number => sum(c, (k) => k.endsWith(".rowsWritten"))
const setAlarm = (c: Counters): number => sum(c, (k) => k.endsWith(".kv.setAlarm"))

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
    `  ${label}: ${p.rowsWritten.total} rows written (agent ${rows.agent}, room ${rows.room}, user ${rows.user}), ` +
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

    const [prompt, quietPrompt, , quietError] = phases
    const promptRows = warmMedian.total
    const agentRows = warmMedian.byObject.agent ?? 0
    const agentAlarmAfterPrompt = quietPrompt?.alarms.armedAgent
    const agentAlarmAfterError = quietError?.alarms.armedAgent
    const backgroundRoomAlarms = (quietPrompt?.alarms.setAlarm.byObject.room ?? 0) + (quietError?.alarms.setAlarm.byObject.room ?? 0)
    console.log(
      BASELINE
        ? `  baseline: ${promptRows} rows per prompt (agent ${prompt?.rowsWritten.byObject.agent ?? 0}), quiet rows ${quietPrompt?.rowsWritten.total ?? 0} then ${quietError?.rowsWritten.total ?? 0}, agent alarm ${describeAlarm(agentAlarmAfterPrompt)} then ${describeAlarm(agentAlarmAfterError)}, room background setAlarm ${backgroundRoomAlarms}, error rows live ${liveErrors} persisted ${persistedErrors}`
        : `  gate: agent median ${agentRows}/${ROW_GATE}, whole prompt median ${promptRows} rows, quiet rows ${quietPrompt?.rowsWritten.total ?? 0} then ${quietError?.rowsWritten.total ?? 0}, agent alarm ${describeAlarm(agentAlarmAfterPrompt)} then ${describeAlarm(agentAlarmAfterError)}, room background setAlarm ${backgroundRoomAlarms}, error rows live ${liveErrors} persisted ${persistedErrors}`,
    )

    // PR 1's gates. The room's and user's own quiet work is reported, not gated: PR 3 moves it onto the run.
    gate(agentRows <= ROW_GATE, `AgentDO wrote a median of ${agentRows} rows across ${WARM_RUNS} warm prompts, the gate is ${ROW_GATE}`)
    gate(agentAlarmAfterPrompt === null, `the agent had an alarm armed ${QUIET_MS / 1000} s after the prompt: ${describeAlarm(agentAlarmAfterPrompt)}`)
    gate((quietPrompt?.rowsWritten.byObject.agent ?? 0) === 0, `the agent wrote ${quietPrompt?.rowsWritten.byObject.agent ?? 0} rows in a quiet minute after the prompt`)
    gate((quietPrompt?.alarms.setAlarm.byObject.agent ?? 0) === 0, `the agent set ${quietPrompt?.alarms.setAlarm.byObject.agent ?? 0} alarms in a quiet minute after the prompt`)
    gate(liveErrors === 1, `an always-failing prompt showed ${liveErrors} error rows live, the gate is 1`)
    gate(persistedErrors === 1, `an always-failing prompt persisted ${persistedErrors} error rows, the gate is 1`)
    gate(agentAlarmAfterError === null, `the agent had an alarm armed ${QUIET_MS / 1000} s after the error: ${describeAlarm(agentAlarmAfterError)}`)
    gate((quietError?.rowsWritten.byObject.agent ?? 0) === 0, `the agent wrote ${quietError?.rowsWritten.byObject.agent ?? 0} rows in a quiet minute after the error`)
    gate((quietError?.alarms.setAlarm.byObject.agent ?? 0) === 0, `the agent set ${quietError?.alarms.setAlarm.byObject.agent ?? 0} alarms in a quiet minute after the error`)
    // A room's own background alarm is labelled, not folded into the agent's gate: PR 3 moves it onto the run.
    if (!BASELINE && backgroundRoomAlarms > 0) console.log(`  note: ${backgroundRoomAlarms} background RoomDO setAlarm calls in the quiet minutes (PR 3 scope)`)

    normal.room.raw.close()
    failing.room.raw.close()
  },
}

export default suite
