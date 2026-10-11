// Shared by the browser suites (phase 17): a Kernel key on the user, a chat on the suite's model,
// one timed turn, and the cleanup that leaves Kernel's active list empty.
import type { RoomToClient } from "@yuki/protocol"
import { connectTestModel, type RoomHandle, type Session, type Verifier, VerifyError } from "./client"
import { api } from "./routine-kit"
import { newRoom } from "./suites/mid-run"

const KERNEL = "https://api.onkernel.com"
export const BROWSER_MODEL = process.env.YUKI_BROWSER_MODEL ?? "opencode-go/muse-spark-1.3-contributor"
const IDLE_PAST_MS = 6 * 60_000

type Events = Extract<RoomToClient, { t: "events" }>
type Status = Extract<RoomToClient, { t: "status" }>

export function kernelKey(): string {
  const key = process.env.KERNEL_API_KEY
  if (!key) throw new VerifyError("KERNEL_API_KEY is not set in this shell")
  return key
}

export async function activeBrowsers(): Promise<string[]> {
  const res = await fetch(`${KERNEL}/browsers?status=active`, { headers: { authorization: `Bearer ${kernelKey()}` }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new VerifyError(`Kernel answered ${res.status} to the active list`)
  return ((await res.json()) as { session_id: string }[]).map((b) => b.session_id)
}

/** Signs in, connects the model and the Kernel key, and sets the TypeSafe key on or off. */
export async function browserUser(v: Verifier, name: string, jev: boolean): Promise<Session> {
  const s = await v.as(name)
  await connectTestModel(s)
  if (jev) {
    const key = process.env.TYPESAFE_API_KEY
    if (!key) throw new VerifyError("TYPESAFE_API_KEY is not set in this shell")
    await s.connectProvider("typesafe", key)
  } else {
    await s.disconnectProvider("typesafe").catch(() => {})
  }
  await connectKernel(s)
  return s
}

/** Connects the user's Kernel key. */
export async function connectKernel(s: Session): Promise<void> {
  const user = await s.user()
  user.send({ t: "connectKernel", apiKey: kernelKey(), reqId: "k1" } as never)
  const answer = (await user.expect((f) => (f as { t: string }).t === "kernel", 60_000)) as unknown as { result: { ok: boolean; error?: string } }
  if (!answer.result.ok) throw new VerifyError(`connecting the Kernel key failed: ${answer.result.error}`)
}

export async function browserRoom(s: Session, title: string): Promise<{ roomId: string; room: RoomHandle }> {
  const opened = await newRoom(s, title)
  opened.room.raw.send({ t: "model", ref: BROWSER_MODEL })
  await Bun.sleep(500)
  return opened
}

/** Sends `question`, collects the agent's bubbles, and waits for idle. */
export async function turn(room: RoomHandle, question: string, ms = 150_000): Promise<{ text: string; total: number }> {
  const t0 = performance.now()
  const clientId = room.send(question)
  await room.expect({ t: "ack", clientId })
  let text = ""
  let replied = false
  for (;;) {
    const f = await room.expect((x) => (x.t === "status" && (x as Status).state === "idle" && replied) || (x.t === "events" && (x as Events).events.some((e) => e.t === "message" && e.from.kind === "agent")), ms)
    if (f.t === "status") break
    replied = true
    for (const e of (f as Events).events) if (e.t === "message" && e.from.kind === "agent") text += `${e.text} / `
  }
  return { text, total: performance.now() - t0 }
}

/**
 * The reaper deletes the user's browser, which must then leave Kernel's active list. Other runs on
 * the same key may hold browsers of their own, so only this user's session must be gone.
 */
export async function closeBrowser(v: Verifier, s: Session): Promise<void> {
  const mine = (await api<{ sessionId: string | null }>(v.url, s, "dev/agent/browser", { action: "state" })).json.sessionId
  await api(v.url, s, "dev/agent/browser", { action: "age", ms: IDLE_PAST_MS })
  await api(v.url, s, "dev/agent/browser", { action: "reap" })
  for (const start = Date.now(); ; await Bun.sleep(2_000)) {
    const left = await activeBrowsers()
    if (!mine || !left.includes(mine)) {
      console.log(`  Kernel active browsers after: [${left.join(", ")}]${left.length ? " (not this run's)" : ""}`)
      return
    }
    if (Date.now() - start > 30_000) throw new VerifyError(`Kernel still lists this user's browser ${mine}`)
  }
}

export const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

/** Step samples from the `browser.step.sample.<ms>` buckets. */
export function stepSamples(counters: Record<string, number>): number[] {
  return Object.entries(counters).flatMap(([k, n]) => {
    const m = /^browser\.step\.sample\.(\d+)$/.exec(k)
    return m ? Array.from({ length: n }, () => Number(m[1])) : []
  })
}

export const mainTurns = (c: Record<string, number>) => (c["model.turns"] ?? 0) - (c["browser.decider.calls"] ?? 0)
