import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle, Session, UserChannel, Verifier } from "../client"
import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { ulid } from "./mid-run"

// How fast the backend feels. Runs KIKO_LATENCY_RUNS turns (default 10) against the scripted fake
// agent of `apps/server/src/agent/dev-fake.ts`, so it spends no tokens, and prints p50 and p95 of
// every step a person waits on. `latency-model` runs the same turn on the test model. Needs a
// development server (`NODE_ENV=development`), which also serves the cost counters of
// `apps/server/src/lib/dev-stats.ts`.
//
// Set KIKO_LATENCY_RESTART to a shell command that restarts the dev server and returns once it is
// healthy (the same contract as KIKO_TURN_RESTART) to also time a reconnect after a restart mid-run.
//
// The suite fails when a step never happens, and when an agent waits for its heartbeat after a
// restart. Every other number is for reading, not for asserting.

/** The room's burst pause after a message (room/burst.ts AFTER_MESSAGE_MS). Subtracted from the burst step. */
const BURST_MS = 1_000
const RUNS = Number(process.env.KIKO_LATENCY_RUNS ?? 10)
const RESTART = process.env.KIKO_LATENCY_RESTART
const RESTART_RUNS = Number(process.env.KIKO_LATENCY_RESTART_RUNS ?? 3)
/** Well under the agent's 30 s heartbeat (agent/host.ts HEARTBEAT_MS). */
const ALIVE_LIMIT_MS = 15_000

type Status = Extract<RoomToClient, { t: "status" }>
type Events = Extract<RoomToClient, { t: "events" }>

export class Samples {
  private readonly rows = new Map<string, number[]>()
  add(name: string, value: number): void {
    const list = this.rows.get(name) ?? []
    list.push(value)
    this.rows.set(name, list)
  }
  print(title: string): void {
    const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
    const width = Math.max(...[...this.rows.keys()].map((k) => k.length))
    console.log(`  ${title}`)
    console.log(`  ${"step".padEnd(width)}  ${"n".padStart(3)}  ${"p50".padStart(8)}  ${"p95".padStart(8)}  ${"max".padStart(8)}`)
    for (const [name, values] of this.rows) {
      const sorted = [...values].sort((a, b) => a - b)
      const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1)).padStart(8)
      console.log(`  ${name.padEnd(width)}  ${String(values.length).padStart(3)}  ${f(pct(sorted, 50))}  ${f(pct(sorted, 95))}  ${f(sorted.at(-1)!)}`)
    }
  }
}

const now = () => performance.now()
const isStatus = (state: string) => (f: RoomToClient) => f.t === "status" && (f as Status).state === state
const agentMessage = (test: (text: string) => boolean = () => true) => (f: RoomToClient) =>
  f.t === "events" && (f as Events).events.some((e) => e.t === "message" && e.from.kind === "agent" && test(e.text))

/** The size on the wire of the newest frame the socket received. */
function lastFrameBytes(room: RoomHandle): number {
  const entry = [...room.raw.log].reverse().find((e) => e.dir === "in")
  return entry ? JSON.stringify(entry.frame).length : 0
}

async function call(v: Verifier, s: Session, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(new URL(path, v.url.endsWith("/") ? v.url : `${v.url}/`), {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: s.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new VerifyError(`${path} answered ${res.status}. start the Worker with NODE_ENV=development`)
  return res
}

export const fake = (v: Verifier, s: Session, roomId: string) => call(v, s, "api/dev/agent/fake", { roomId })
export const resetStats = (v: Verifier, s: Session) => call(v, s, "api/dev/stats/reset", {})
export async function readStats(v: Verifier, s: Session): Promise<Record<string, number>> {
  return ((await (await call(v, s, "api/dev/stats")).json()) as { counters: Record<string, number> }).counters
}

/** Folds counters into the few numbers a turn costs. */
export function cost(c: Record<string, number>): Record<string, number> {
  const sum = (test: (k: string) => boolean) => Object.entries(c).reduce((n, [k, v]) => (test(k) ? n + v : n), 0)
  const out: Record<string, number> = {
    "rpc calls": sum((k) => k.startsWith("rpc.")),
    "sql statements": sum((k) => k.endsWith(".statements")),
    "rows written": sum((k) => k.endsWith(".rowsWritten")),
    "rows read": sum((k) => k.endsWith(".rowsRead")),
    "kv and alarm calls": sum((k) => k.includes(".kv.")),
  }
  for (const [k, v] of Object.entries(c)) if (k.startsWith("rpc.") || k.includes(".kv.") || k.endsWith("rowsWritten") || k.endsWith("rowsRead")) out[`  ${k}`] = v
  return out
}

/**
 * One human message and its answer, timed. `marker` picks the fake's script. Returns once the
 * agent is idle again.
 */
/** Adds a chat through the user socket, then opens the room and times its connect and first frame. */
async function openRoom(s: Session, user: UserChannel, title: string, samples?: Samples) {
  const roomId = ulid()
  user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const t0 = now()
  const room = await s.room(roomId)
  await room.expect((f) => f.t === "events" || f.t === "reset")
  samples?.add("cold connect to first frame (new room)", now() - t0)
  return { roomId, room }
}

export async function timedTurn(room: RoomHandle, text: string, samples: Samples, tag: string, timeout = 30_000): Promise<void> {
  const t0 = now()
  const clientId = room.send(text)
  await room.expect({ t: "ack", clientId })
  const tAck = now()
  samples.add("send to ack", tAck - t0)
  await room.expect(isStatus("typing"), timeout)
  const tTyping = now()
  samples.add(`burst close to typing (${tag})`, tTyping - tAck - BURST_MS)
  const first = await room.expect(agentMessage(), timeout)
  const tFirst = now()
  samples.add(`typing to first bubble (${tag})`, tFirst - tTyping)
  let tLast = tFirst
  let bubbles = (first as Events).events.filter((e) => e.t === "message").length
  for (;;) {
    const f = await room.expect((x) => isStatus("idle")(x) || agentMessage()(x), timeout)
    if (f.t === "status") break
    const t = now()
    samples.add(`gap between bubbles (${tag})`, t - tLast)
    tLast = t
    bubbles++
  }
  samples.add(`last bubble to idle (${tag})`, now() - tLast)
  samples.add(`bubbles per answer (${tag})`, bubbles)
}

async function fakeRuns(v: Verifier): Promise<void> {
  const s = await v.as("latency")
  const user = await s.user()
  const samples = new Samples()
  const costs = new Samples()
  const warmCosts = new Samples()
  for (let i = 0; i < RUNS; i++) {
    // Cold: a room object that has never run.
    const { roomId, room } = await openRoom(s, user, `latency ${i}`, samples)
    await fake(v, s, roomId)
    await resetStats(v, s)
    await timedTurn(room, `cold ${i}`, samples, "cold agent")
    await Bun.sleep(300)
    for (const [k, n] of Object.entries(cost(await readStats(v, s)))) costs.add(k, n)
    await resetStats(v, s)
    await timedTurn(room, `warm ${i}`, samples, "warm agent")
    await Bun.sleep(300)
    for (const [k, n] of Object.entries(cost(await readStats(v, s)))) warmCosts.add(k, n)

    // Warm reconnect, the way a client resumes after a dropped socket. The verify client always
    // says lastSeq 0, so this is the full replay a fresh tab gets.
    const t1 = now()
    await room.reconnect()
    await room.expect((f) => f.t === "events" || f.t === "reset")
    samples.add("warm reconnect to first frame", now() - t1)
    samples.add("hello reply bytes (4 messages)", lastFrameBytes(room))

    // Stop while the fake writes a long paragraph.
    const clientId = room.send(`[slow] stop me ${i}`)
    await room.expect({ t: "ack", clientId })
    await room.expect(isStatus("typing"), 15_000)
    await Bun.sleep(300)
    const t2 = now()
    room.raw.send({ t: "stop" })
    await room.expect(isStatus("idle"), 10_000)
    samples.add("stop to idle", now() - t2)
    room.raw.close()
  }
  samples.print(`fake agent, ${RUNS} runs (ms)`)
  costs.print("cost of one cold turn (counts)")
  warmCosts.print("cost of one warm turn (counts)")

  // Snapshot size: a room with many messages. 40 sends, then a fresh hello.
  const { roomId: sizeId, room } = await openRoom(s, user, "latency size")
  await fake(v, s, sizeId)
  for (let i = 0; i < 40; i++) {
    const clientId = room.send(`message ${i} with a few words of ordinary length in it`)
    await room.expect({ t: "ack", clientId })
  }
  await room.reconnect()
  await room.expect((f) => f.t === "events" || f.t === "reset")
  console.log(`  hello reply for 40 human messages: ${lastFrameBytes(room)} bytes`)
  // A client ahead of the log gets a snapshot. Count what building one costs.
  await Bun.sleep(3_000)
  await resetStats(v, s)
  room.raw.send({ t: "hello", lastSeq: 1_000_000 })
  await room.expect((f) => f.t === "reset")
  const snap = await readStats(v, s)
  console.log(`  snapshot reply: ${lastFrameBytes(room)} bytes, ${snap["room.statements"] ?? 0} sql statements`)
  await user.reconnect()
  const hello = await user.expect((f) => f.t === "events" || f.t === "reset")
  console.log(`  user hello reply after ${RUNS * 2} runs: ${JSON.stringify(hello).length} bytes (${hello.t})`)
}

async function restartRuns(v: Verifier): Promise<void> {
  if (!RESTART) {
    console.log("  skip restart timing (set KIKO_LATENCY_RESTART)")
    return
  }
  const s = await v.as("latency")
  const user = await s.user()
  const samples = new Samples()
  for (let i = 0; i < RESTART_RUNS; i++) {
    const { roomId, room } = await openRoom(s, user, `latency restart ${i}`)
    await fake(v, s, roomId)
    const clientId = room.send(`[slow] restart ${i}`)
    await room.expect({ t: "ack", clientId })
    await room.expect(isStatus("typing"), 15_000)
    const t0 = now()
    const proc = Bun.spawn(["sh", "-c", RESTART], { stdout: "ignore", stderr: "inherit" })
    if ((await proc.exited) !== 0) throw new VerifyError("the restart command failed")
    const tUp = now()
    samples.add("restart command (server down and up)", tUp - t0)
    for (;;) {
      try {
        await room.reconnect()
        break
      } catch {
        await Bun.sleep(200)
      }
    }
    await room.expect((f) => f.t === "events" || f.t === "reset", 10_000)
    samples.add("server up to transcript replayed", now() - tUp)
    // The agent resumes on its own. Its first sign of life, then the answer the run was writing.
    await room.expect((f) => f.t === "status" || f.t === "draft" || agentMessage()(f), 120_000)
    const alive = now() - tUp
    samples.add("server up to agent alive again", alive)
    // The room wakes the agent when the human reconnects. Waiting for the 30 s heartbeat is the bug.
    if (alive > ALIVE_LIMIT_MS) throw new VerifyError(`the agent came back after ${Math.round(alive)} ms. the room did not wake it`)
    await room.expect(agentMessage((t) => t.includes(`[slow] restart ${i}`)), 120_000)
    samples.add("server up to answer in transcript", now() - tUp)
    room.raw.close()
    await user.reconnect()
  }
  samples.print(`restart mid-run, ${RESTART_RUNS} runs (ms)`)
}

const suite: Suite = {
  name: "latency",
  async run(v) {
    await fakeRuns(v)
    await restartRuns(v)
  },
}

export default suite
