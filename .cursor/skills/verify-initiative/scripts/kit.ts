// Helpers for initiative scenarios with REAL models. Import from a scenario script:
//   import { setup, openChat, say, lifeLines, usage, setJev, age, seen, save } from "./kit"
// Keys come from the shell (`set -a; . apps/server/.dev.vars; set +a`). Nothing here prints one.
import type { LifeLine, MemoryOp, MemoryResult } from "@kiko/protocol"
import { connectTestModel, type RoomHandle, type Session, type UserChannel, VerifyError, createVerifier, type Verifier } from "../../../../apps/cli/src/verify/client"
import { agentTexts, dev, eventually, messages, ok, routines } from "../../../../apps/cli/src/verify/routine-kit"
import { statuses, ulid } from "../../../../apps/cli/src/verify/suites/mid-run"
import { mkdirSync, writeFileSync } from "node:fs"

// Load the two keys from apps/server/.dev.vars when the shell does not have them. Values are never printed.
for (const line of (await Bun.file(new URL("../../../../apps/server/.dev.vars", import.meta.url)).text().catch(() => "")).split("\n")) {
  const m = /^(OPENCODE_API_KEY|TYPESAFE_API_KEY)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "")
}

export { agentTexts, dev, eventually, routines, statuses, VerifyError }
export const TYPESAFE = "typesafe"
export const URL_ = process.env.KIKO_URL ?? "http://localhost:8787"

export interface Ctx { v: Verifier; s: Session; user: UserChannel; dir: string; jev: boolean; n: number }
export type Chat = RoomHandle & { id: string }

/** Signs in as a dev user (same name, same user), connects OpenCode Go, and sets Jev on or off. */
export async function setup(opts: { name: string; jev: boolean; policy?: Record<string, unknown> }): Promise<Ctx> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = `${process.env.INITIATIVE_OUT ?? "artifacts/initiative"}/${stamp}-${opts.name}`
  mkdirSync(dir, { recursive: true })
  const v = createVerifier(URL_)
  const s = await v.as(opts.name)
  await connectTestModel(s) // opencode-go from OPENCODE_API_KEY, then picks Kiko's model (KIKO_TEST_MODEL, else muse-spark-1.3-contributor)
  const ctx: Ctx = { v, s, user: await s.user(), dir, jev: false, n: 0 }
  await setJev(ctx, opts.jev)
  await dev(URL_, s, "policy", { policy: { batch: 2, idleMs: 3_000, jevDelayMs: 1_000, ...opts.policy } })
  return ctx
}

/** Jev on: store TYPESAFE_API_KEY through the credentials route. Off: delete the credential. */
export async function setJev(ctx: Ctx, on: boolean): Promise<void> {
  if (on) {
    const key = process.env.TYPESAFE_API_KEY
    if (!key) throw new VerifyError("TYPESAFE_API_KEY is not set in this shell")
    await ctx.s.connectProvider(TYPESAFE, key)
  } else await ctx.s.disconnectProvider(TYPESAFE)
  ctx.jev = on
}

export async function openChat(ctx: Ctx, title: string): Promise<Chat> {
  const roomId = ulid()
  ctx.user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title } })
  await ctx.user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await ctx.s.room(roomId)
  await room.expect((f) => f.t === "events")
  return Object.assign(room, { id: roomId })
}

/** The human says something; waits for the agent to go idle; returns the agent bubbles it produced. */
export async function say(room: RoomHandle, text: string, ms = 90_000): Promise<string[]> {
  const before = statuses(room).filter((x) => x === "idle").length
  const seenBefore = messages(room).length
  room.send(text)
  await eventually(`an answer to ${JSON.stringify(text)}`, () => statuses(room).filter((x) => x === "idle").length > before, ms)
  await Bun.sleep(500)
  return messages(room).slice(seenBefore).filter((m) => m.from.kind === "agent").map((m) => m.text)
}

/** Everything in the room log (human, agent, system), in order. */
export const transcript = (room: RoomHandle) => messages(room).map((m) => ({ seq: m.seq, from: m.from.kind === "agent" ? `@${(m.from as { slug: string }).slug}` : m.from.kind, text: m.text }))

export async function memory(ctx: Ctx, op: MemoryOp): Promise<MemoryResult> {
  const reqId = `m${++ctx.n}`
  ctx.user.send({ t: "memory", reqId, op })
  return ((await ctx.user.expect((f) => f.t === "memory_result" && f.reqId === reqId)) as { result: MemoryResult }).result
}
export async function lifeLines(ctx: Ctx): Promise<readonly LifeLine[]> {
  const r = await memory(ctx, { op: "list", limit: 200 })
  if (!("lines" in r)) throw new VerifyError(`memory list answered ${JSON.stringify(r)}`)
  return r.lines
}

/** Tokens spent: `agent` is the room's agent, `memory` is the user's background counters (MEMORY_USAGE). */
export async function usage(ctx: Ctx, room: Chat, slug?: string): Promise<{ agent: Record<string, number>; memory: Record<string, number> }> {
  return (await dev(URL_, ctx.s, "usage", { roomId: room.id, slug })) as never
}
/** Background tokens: memory counters whose names say model or jev input/output. */
export const background = (m: Record<string, number>) => Object.entries(m).filter(([k]) => /(^|_)(input|output)$/.test(k)).reduce((a, [, n]) => a + n, 0)

/** Ages open tasks by `ms` and runs the stall sweep (nudges). Does NOT age memory, loops, or routines. */
export const age = (ctx: Ctx, room: Chat, ms: number) => dev(URL_, ctx.s, "age", { roomId: room.id, ms })
/** Says the human was last seen `ago` ms back (holds unasked runs after a week). */
export const seen = (ctx: Ctx, ago: number) => dev(URL_, ctx.s, "seen", { ago })
/** Makes routine `id` due now. */
export const due = (ctx: Ctx, id: string) => dev(URL_, ctx.s, "due", { id })

/** The user's reminders (`GET /api/reminders`): what the agent scheduled. */
export const reminders = (ctx: Ctx) => ok<unknown>(URL_, ctx.s, "reminders")

export function save(ctx: Ctx, name: string, data: unknown): string {
  const path = `${ctx.dir}/${name}.json`
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}
export { ok }
