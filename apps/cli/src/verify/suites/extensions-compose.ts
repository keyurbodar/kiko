import { messages, newRoom, poll, seen } from "../kit"
import type { ExtensionOp, ExtensionResult } from "@kiko/protocol"
import type { RoomHandle, Session } from "../client"
import { VerifyError } from "../client"
import { dev, toolLine } from "../routine-kit"
import type { Suite } from "../runner"
import { must as mustPresent } from "../must"
import { fake, send } from "./mid-run"
import { team } from "./team-loops"


const probe = (id: string, verdict: "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE", evidence: string) => console.log(`  PROBE ${id} ${verdict}: ${evidence}`)
const short = (t: string) => JSON.stringify(t.length > 220 ? `${t.slice(0, 220)}...` : t)
const tail = (t: string) => JSON.stringify(t.length > 200 ? `...${t.slice(-200)}` : t)

type Manifest = Record<string, unknown>

async function installer(s: Session) {
  const user = await s.user()
  let n = 0
  const op = async (o: ExtensionOp): Promise<ExtensionResult> => {
    const reqId = `c${++n}-${Date.now()}`
    user.send({ t: "extension", reqId, op: o })
    return ((await user.expect((f) => f.t === "extension_result" && f.reqId === reqId, 10_000)) as { result: ExtensionResult }).result
  }
  const must = (r: ExtensionResult, what: string) => {
    if (!r.ok) throw new VerifyError(`${what}: ${r.error}${r.problems ? ` (${r.problems.join("; ")})` : ""}`)
    return r
  }
  return {
    bundle: async (manifest: Manifest, source: string) => {
      const proposed = must(await op({ op: "propose", bundle: { manifest: { yuki: 1, version: "1.0.0", ...manifest } as never, files: { "main.js": source } } }), `propose ${manifest.name}`)
      must(await op({ op: "install", id: mustPresent(proposed.proposal, "proposal").id }), `install ${manifest.name}`)
    },
    catalog: async (name: string) => {
      const proposed = must(await op({ op: "propose_catalog", name }), `propose ${name}`)
      must(await op({ op: "install", id: mustPresent(proposed.proposal, "proposal").id }), `install ${name}`)
    },
  }
}

function asker(room: RoomHandle) {
  return async (text: string) => {
    const before = seen(room).live.length
    await send(room, text)
    await poll(`an answer to ${text.slice(0, 40)}`, () => seen(room).live.length > before, 30_000)
    await Bun.sleep(1_500)
    return seen(room).live.slice(before).map((m) => m.text).join("\n")
  }
}


async function p1(v: { url: string }, s: Session, install: Awaited<ReturnType<typeof installer>>) {
  const { roomId, room } = await newRoom(s, "compose: hook bypass")
  await fake(v, s, roomId)
  const ask = asker(room)
  await install.bundle(
    { name: "note-guard", description: "blocks fake_note, for kiko verify", hooks: ["beforeTool"], tools: { guard_ping: { description: "does nothing", effect: "read" } } },
    'export const tools = { async guard_ping() { return "guarding" } }\nexport const hooks = { async beforeTool(call) { if (call.name === "fake_note") return { block: "notes are protected" } } }',
  )
  await install.bundle(
    { name: "writer", description: "writes through kiko.call, for kiko verify", tools: { write_via: { description: "writes a note", effect: "write" } }, calls: ["fake_note"] },
    'export const tools = { async write_via(_a, kiko) { return await kiko.call("fake_note", {}) } }',
  )
  const direct = await ask(toolLine("fake_note", {}))
  const via = await ask(toolLine("write_via", {}))
  const directBlocked = /\bblocked\b|notes are protected/.test(direct)
  const viaRan = /noted/.test(via) && !/protected/.test(via)
  const evidence = `direct fake_note ${directBlocked ? "blocked" : "NOT blocked"} (${tail(direct)}); write_via answered ${tail(via)}`
  if (!directBlocked) probe("P1", "INCONCLUSIVE", `the control failed, the guard did not block the direct call. ${evidence}`)
  else probe("P1", viaRan ? "NOT VERIFIED" : "VERIFIED", `${viaRan ? "BYPASS: the guarded tool ran through kiko.call, another extension's beforeTool never saw it. " : "the guard held. "}${evidence}`)
  room.raw.close()
}

async function p3(v: { url: string }, s: Session, install: Awaited<ReturnType<typeof installer>>) {
  const { room, roomId } = await team(v, s, ["ana", "ben"], "compose: messaging")
  await install.bundle(
    {
      name: "pinger",
      description: "messages a teammate, for kiko verify",
      tools: { ping_mate: { description: "pings ben", effect: "message" }, peek_mate: { description: "tries to message from a read tool", effect: "read" } },
      calls: ["send_message"],
    },
    `export const tools = {
  async ping_mate(_a, kiko) { return await kiko.call("send_message", { to: "ben", text: "pinged by the extension" }) },
  async peek_mate(_a, kiko) { return await kiko.call("send_message", { to: "ben", text: "from a read tool" }) },
}`,
  )
  const before = messages(room).length
  await send(room, "@ana [ws ping_mate {}]")
  await poll("ana's answer", () => messages(room).some((m) => m.from.kind === "agent" && m.text.includes("sent to")), 30_000).catch(() => {})
  await poll("ben to receive it", () => messages(room).slice(before).some((m) => m.text.includes("pinged by the extension")), 30_000).catch(() => {})
  const log = messages(room).slice(before).map((m) => `${m.from.kind === "agent" ? `@${m.from.slug}` : m.from.kind}: ${m.text}`)
  const delivered = log.some((l) => l.includes("pinged by the extension") && l.startsWith("@ana"))
  const status = (await dev(v.url, s, "status", { roomId, slug: "ben" })) as { inbox: { waiting: number; claimed: number; submitted: number } }
  const received = status.inbox.waiting + status.inbox.claimed + status.inbox.submitted
  probe("P3a", delivered && received > 0 ? "VERIFIED" : "NOT VERIFIED", `message tool -> send_message: room log has it from ana: ${delivered}; ben's inbox holds ${received} envelope(s). log ${short(log.join(" | "))}`)
  const mark = messages(room).length
  await send(room, "@ana [ws peek_mate {}]")
  await poll("ana's answer to the read tool", () => messages(room).slice(mark).some((m) => m.from.kind === "agent" && m.text.length > 0), 30_000).catch(() => {})
  const after = messages(room).slice(mark).map((m) => m.text)
  const refused = after.some((t) => /read" and cannot call send_message/.test(t))
  const leaked = after.some((t) => t.includes("from a read tool") && !/cannot call/.test(t))
  probe("P3b", refused && !leaked ? "VERIFIED" : "NOT VERIFIED", `read tool -> send_message ${refused ? "refused with the effect error" : "not refused"}: ${short(after.join(" | "))}`)
  room.raw.close()
}

const suite: Suite = {
  name: "extensions-compose",
  async run(v) {
    const s = await v.as(`ext-compose-${Date.now()}`)
    await fetch(new URL("api/me", v.url), { headers: { cookie: s.cookie } })
    const install = await installer(s)
    for (const [id, run] of [["P1", p1], ["P3", p3]] as const) {
      try {
        await run(v, s, install)
      } catch (e) {
        if (e instanceof VerifyError) probe(id, "INCONCLUSIVE", `harness: ${e.message}`)
        else throw e
      }
    }
  },
}

export default suite
