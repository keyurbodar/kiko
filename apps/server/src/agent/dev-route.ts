import { isAgentSlug, isRoomId } from "@yuki/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { agentStub, roomStub, userStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"
import { MAX_MEMBERS } from "../room/members"

// DEVELOPMENT ONLY. The verify suites `mid-run` (P1-12) and `team-routing` (P6-01) ask for the
// scripted fake agent of `dev-fake.ts` in one of the session user's rooms, so they spend no tokens.
//
//   POST /api/dev/agent/fake    { roomId, slugs? }  -> { ok: true }   slugs default to [DEFAULT_AGENT]
//   POST /api/dev/agent/status  { roomId, slug }    -> the agent's `status()`: inbox counts and submissions
//   POST /api/dev/agent/limits  { limits }  -> { limits }   the session user's plan record (P9-01)
//   GET  /api/dev/agent/workers?roomId=         -> { workers: [Work] }   the agent's background workers (section 8, `verify workers`)
//   POST /api/dev/agent/seed    { roomId, turns: [{ from, text }] }  -> { turns }   (section 13, `verify memory-eval`)
//   POST /api/dev/agent/memory  { roomId }  -> { turns, pending, view }
//   POST /api/dev/agent/classic { roomId }  -> { ok: true }   the room's agent keeps the old transcript (`verify token-cost`)
//   POST /api/dev/agent/usage   { roomId, slug? }  -> { agent, memory }   tokens the agent and memory summaries spent
//   POST /api/dev/agent/budget  { roomId, slug?, ms }  -> the agent's budget for runs nobody asked for (section 25.2)
//   POST /api/dev/agent/age     { roomId, ms }  -> { open }   ages open tasks and reports them to UserDO (section 26.6)
//   POST /api/dev/agent/seen    { ago }  -> the human was last seen `ago` ms back (section 25.5)
//   POST /api/dev/agent/due     { id }   -> routine `id` is due now (section 25)
//   POST /api/dev/agent/policy  { policy }  -> { ok: true }   sets the user's `memory_policy` setting (`verify memory-jev`)
//   POST /api/dev/agent/loops   { open?: { roomId, text, due? } }  -> { loops }   every loop, done or not; `open` adds a human loop first (section 26)
//   POST /api/dev/agent/quiet   { roomId }  -> { ok }   rolls the chat up now, as six quiet hours would (`verify initiative-loops`)
//   POST /api/dev/agent/initiative { roomId, slug? }  -> { text }   the initiative lines the agent's last run started with
//   POST /api/dev/agent/attention { action: "age", ms } | { action: "rhythm", mode: "now" | "clear" } | { action: "pass" } | { action: "state" }
//        the initiative engine (section 26.8): age its clock state, set a known rhythm, run a pass now (returns its
//        verdicts and wakes), or read the rhythm, appetite, marks, and wakes
//   POST /api/dev/agent/browser { action, agentId?, mode?, ms? }  -> the user's Kernel lease: lease, touch, dead, age, reap, switch, state (section 27, `verify kernel`)
//   POST /api/dev/agent/pending { roomId, ms }  -> { pending }   ages the room's pending uploads and sweeps them (section 18.1)
//
// `seed` writes messages straight into the room's log, with no burst and no run, so a long chat costs
// no tokens to set up. `from` is "human" or an agent slug. `memory` reports the room's log memory.
//
// A production build answers 404, and so does any host but localhost.

declare const process: { env: { NODE_ENV?: string } }

const PREFIX = "/api/dev/agent/"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export async function devAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const action = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : null
  if (!["fake", "status", "workers", "limits", "seed", "memory", "classic", "usage", "trace", "budget", "age", "seen", "due", "pending", "policy", "loops", "quiet", "initiative", "attention", "browser"].includes(action ?? "")) return null
  if (process.env.NODE_ENV !== "development" || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
  // P9-01: set the session user's plan record, so `verify limits` can lower and raise it.
  if (action === "limits") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { limits?: Record<string, unknown> } | null
    return Response.json({ limits: await userStub(env.USER, user.id).setLimits(body?.limits ?? {}) })
  }
  if (action === "policy") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { policy?: unknown } | null
    if (!body?.policy || typeof body.policy !== "object") return Response.json({ error: "bad policy" }, { status: 400 })
    await userStub(env.USER, user.id).devSetting("memory_policy", JSON.stringify(body.policy))
    return Response.json({ ok: true })
  }
  // Section 25: make a routine due now.
  if (action === "due") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null
    await userStub(env.USER, user.id).devDue(String(body?.id ?? ""))
    return Response.json({ ok: true })
  }
  // Section 25: move the human's last visit back `ago` ms.
  if (action === "seen") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { ago?: unknown } | null
    await userStub(env.USER, user.id).devSeen(Number(body?.ago ?? 0))
    return Response.json({ ok: true })
  }
  if (action === "browser") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { action?: unknown; agentId?: unknown; mode?: unknown; ms?: unknown } | null
    const known = ["lease", "touch", "dead", "age", "reap", "switch", "state"] as const
    const op = known.find((k) => k === body?.action)
    if (!op) return Response.json({ error: "bad action" }, { status: 400 })
    try {
      return Response.json(await userStub(env.USER, user.id).devBrowser({ action: op, agentId: body?.agentId as string, mode: body?.mode === "headful" ? "headful" : "headless", ms: Number(body?.ms ?? 0) }))
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 })
    }
  }
  if (action === "attention") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { action?: unknown; ms?: unknown; mode?: unknown } | null
    const op =
      body?.action === "age"
        ? ({ action: "age", ms: Number(body.ms ?? 0) } as const)
        : body?.action === "rhythm"
          ? ({ action: "rhythm", mode: body.mode === "clear" ? "clear" : "now" } as const)
          : body?.action === "pass"
            ? ({ action: "pass" } as const)
            : ({ action: "state" } as const)
    return Response.json(await userStub(env.USER, user.id).devInitiative(op))
  }
  if (action === "loops") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    // `open` puts a human loop in a chat, as the background pass would, for the fake-agent suites.
    const body = (await request.json().catch(() => null)) as { open?: { roomId?: unknown; text?: unknown; due?: unknown } } | null
    const open = body?.open
    if (open && typeof open.roomId === "string" && isRoomId(open.roomId) && typeof open.text === "string") {
      await userStub(env.USER, user.id).loopOpen("human", open.roomId, "", { kind: "intention", certainty: "explicit", text: open.text, due: typeof open.due === "string" ? open.due : null })
    }
    return Response.json({ loops: await userStub(env.USER, user.id).loopList({ status: ["open", "done", "dropped", "snoozed"], limit: 200 }) })
  }
  if (action === "workers") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const roomId = url.searchParams.get("roomId") ?? ""
    if (!isRoomId(roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
    return Response.json({ workers: await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devWorkers() })
  }
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { roomId?: unknown; slugs?: unknown; slug?: unknown; turns?: unknown } | null
  if (typeof body?.roomId !== "string" || !isRoomId(body.roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
  const roomId = body.roomId
  if (action === "seed") {
    const turns = Array.isArray(body.turns) ? (body.turns as { from?: unknown; text?: unknown }[]) : []
    if (!turns.length || turns.length > 5_000 || !turns.every((t) => typeof t.text === "string" && (t.from === "human" || (typeof t.from === "string" && isAgentSlug(t.from))))) {
      return Response.json({ error: "bad turns" }, { status: 400 })
    }
    return Response.json({ turns: await roomStub(env.ROOM, user.id, roomId).devSeed(turns as { from: string; text: string }[]) })
  }
  if (action === "quiet") {
    await roomStub(env.ROOM, user.id, roomId).devQuiet()
    return Response.json({ ok: true })
  }
  if (action === "memory") return Response.json(await roomStub(env.ROOM, user.id, roomId).devMemory())
  if (action === "pending") return Response.json({ pending: await roomStub(env.ROOM, user.id, roomId).devAgePending(Number((body as { ms?: unknown }).ms ?? 0)) })
  if (action === "age") return Response.json({ open: await roomStub(env.ROOM, user.id, roomId).devAge(Number((body as { ms?: unknown }).ms ?? 0)) })
  if (action === "budget") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    await agentStub(env.AGENT, user.id, roomId, slug).devBudget(Number((body as { ms?: unknown }).ms ?? 0))
    return Response.json({ ok: true })
  }
  if (action === "usage") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    return Response.json({ agent: await agentStub(env.AGENT, user.id, roomId, slug).devUsage(), memory: await userStub(env.USER, user.id).memoryUsage() })
  }
  if (action === "initiative") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    return Response.json({ text: await agentStub(env.AGENT, user.id, roomId, slug).devInitiative() })
  }
  if (action === "trace") return Response.json(await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devTrace())
  if (action === "classic") {
    await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devClassic()
    return Response.json({ ok: true })
  }
  const slugs = action === "status" ? [body.slug] : (body.slugs ?? [DEFAULT_AGENT])
  if (!Array.isArray(slugs) || !slugs.length || slugs.length > MAX_MEMBERS || !slugs.every((s) => typeof s === "string" && isAgentSlug(s))) {
    return Response.json({ error: "bad slugs" }, { status: 400 })
  }
  const agents = (slugs as string[]).map((slug) => agentStub(env.AGENT, user.id, roomId, slug))
  if (action === "status") return Response.json(await agents[0]!.status())
  for (const agent of agents) await agent.devFake()
  return Response.json({ ok: true })
}
