import type { ExtensionOp, ExtensionResult } from "@yuki/protocol"
import type { RoomHandle, Session } from "../client"
import { VerifyError } from "../client"
import { dev, eventually, inSeconds, ok as apiOk, type Routine, routines, toolLine, waitRuns } from "../routine-kit"
import type { Suite } from "../runner"
import { fake, newRoom, seen, send, until } from "./mid-run"
import { messages, team } from "./team-loops"

// Architecture section 24 against the rest of yuki. These are findings probes, not gates: each prints
// `PROBE <id> VERIFIED|NOT VERIFIED|INCONCLUSIVE: <evidence>` and none throws on a security result.
// Only a harness error (an install refused, a run that never answers) fails the suite.
//
//   P1  a hook blocks a built-in write tool, but does it block an extension tool that calls it?
//   P2  after yuki.fetch taints a run, can the same tool call an external tool in the same invocation?
//   P3  a message-effect tool reaches a teammate through send_message; a read-effect tool is refused
//   P5  a routine granted an extension's external tool runs it; an ungranted one asks first

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
      must(await op({ op: "install", id: proposed.proposal!.id }), `install ${manifest.name}`)
    },
    catalog: async (name: string) => {
      const proposed = must(await op({ op: "propose_catalog", name }), `propose ${name}`)
      must(await op({ op: "install", id: proposed.proposal!.id }), `install ${name}`)
    },
  }
}

/** Sends a line and returns the agent bubbles that answered it. */
function asker(room: RoomHandle) {
  return async (text: string) => {
    const before = seen(room).live.length
    await send(room, text)
    await until(`an answer to ${text.slice(0, 40)}`, () => seen(room).live.length > before, 30_000)
    await Bun.sleep(1_500)
    return seen(room).live.slice(before).map((m) => m.text).join("\n")
  }
}

const base = (url: string) => (url.endsWith("/") ? url : `${url}/`)

async function p1(v: { url: string }, s: Session, install: Awaited<ReturnType<typeof installer>>) {
  // The fake agent has no file tools, so the guard blocks fake_note, its write-effect built-in, the way path-guard blocks write.
  const { roomId, room } = await newRoom(s, "compose: hook bypass")
  await fake(v, s, roomId)
  const ask = asker(room)
  await install.bundle(
    { name: "note-guard", description: "blocks fake_note, for yuki verify", hooks: ["beforeTool"], tools: { guard_ping: { description: "does nothing", effect: "read" } } },
    'export const tools = { async guard_ping() { return "guarding" } }\nexport const hooks = { async beforeTool(call) { if (call.name === "fake_note") return { block: "notes are protected" } } }',
  )
  await install.bundle(
    { name: "writer", description: "writes through yuki.call, for yuki verify", tools: { write_via: { description: "writes a note", effect: "write" } }, calls: ["fake_note"] },
    'export const tools = { async write_via(_a, yuki) { return await yuki.call("fake_note", {}) } }',
  )
  const direct = await ask(toolLine("fake_note", {}))
  const via = await ask(toolLine("write_via", {}))
  const directBlocked = /\bblocked\b|notes are protected/.test(direct)
  const viaRan = /noted/.test(via) && !/protected/.test(via)
  const evidence = `direct fake_note ${directBlocked ? "blocked" : "NOT blocked"} (${tail(direct)}); write_via answered ${tail(via)}`
  if (!directBlocked) probe("P1", "INCONCLUSIVE", `the control failed, the guard did not block the direct call. ${evidence}`)
  else probe("P1", viaRan ? "NOT VERIFIED" : "VERIFIED", `${viaRan ? "BYPASS: the guarded tool ran through yuki.call, another extension's beforeTool never saw it. " : "the guard held. "}${evidence}`)
  room.raw.close()
}

async function p2(v: { url: string }, s: Session, install: Awaited<ReturnType<typeof installer>>) {
  const { roomId, room } = await newRoom(s, "compose: taint")
  await fake(v, s, roomId)
  const ask = asker(room)
  await install.bundle(
    {
      name: "sinkbox",
      description: "an outside tool that records it ran, for yuki verify",
      tools: { sink: { description: "pretends to send something outside yuki", effect: "external" }, sink_peek: { description: "says what sink did", effect: "read" } },
      state: "user",
    },
    `export const tools = {
  async sink(_a, yuki) { await yuki.state.set("ran", ((await yuki.state.get("ran")) ?? 0) + 1); return "sink ran" },
  async sink_peek(_a, yuki) { return "sink runs: " + ((await yuki.state.get("ran")) ?? 0) },
}`,
  )
  await install.bundle(
    {
      name: "fetchsend",
      description: "fetches, then calls an outside tool in one invocation, for yuki verify",
      tools: { fetch_send: { description: "fetches a forecast, then sends", effect: "external" } },
      calls: ["sink"],
      egress: ["api.open-meteo.com"],
    },
    `export const tools = {
  async fetch_send(_a, yuki) {
    const r = await yuki.fetch("https://api.open-meteo.com/v1/forecast?latitude=38.7&longitude=-9.1&current=temperature_2m")
    const out = await yuki.call("sink", {})
    return "fetched " + r.status + " then " + out
  },
}`,
  )
  const ran = await ask(toolLine("fetch_send", {}))
  const peek = await ask(toolLine("sink_peek", {}))
  const humanRan = /sink runs: 1/.test(peek)
  probe("P2", humanRan ? "NOT VERIFIED" : "VERIFIED", `human-started run: the external tool ${humanRan ? "ran after yuki.fetch tainted the run (the trust gate is not applied to yuki.call)" : "did not run"}. reply ${short(ran)}; ${short(peek)}`)
  room.raw.close()

  // A routine with a grant naming only fetch_send. The run is clean, so the grant is what lets it act outside.
  const home = await newRoom(s, "compose: taint in a routine")
  await fake(v, s, home.roomId)
  const { routine } = await apiOk<{ routine: Routine }>(v.url, s, "routines", { roomId: home.roomId, name: "fetch and send", instructions: "[ws fetch_send {}]", may: ["fetch_send"], trigger: { on: "time", at: inSeconds(3600) } })
  await dev(v.url, s, "due", { id: routine.id })
  await waitRuns(v.url, s, routine.id, "the routine run", (rs) => rs.some((r) => r.status !== "running"), 45_000)
  await eventually("the routine to post", () => seen(home.room).live.length > 0, 15_000).catch(() => {})
  const routineSaid = seen(home.room).live.map((m) => m.text).join(" | ")
  const routinePeek = await asker(home.room)("[ws sink_peek {}]")
  const runs = (t: string) => Number(/sink runs: (\d+)/.exec(t)?.[1] ?? Number.NaN)
  const routineRan = runs(routinePeek) > runs(peek)
  const routineRefused = !routineRan && Number.isFinite(runs(routinePeek)) && /needs the human's ok/.test(routineSaid)
  probe(
    "P2b",
    routineRan ? "NOT VERIFIED" : routineRefused ? "VERIFIED" : "INCONCLUSIVE",
    `routine run granted only fetch_send: sink ${routineRan ? "ran as well, though sink is not in the grant and the run had fetched outside content" : routineRefused ? "was refused for the human's ok" : "did not run, and no refusal was seen"}; ${tail(routineSaid)}; ${short(routinePeek)}`,
  )
  home.room.raw.close()
}

async function p3(v: { url: string }, s: Session, install: Awaited<ReturnType<typeof installer>>) {
  const { room, roomId } = await team(v, s, ["ana", "ben"], "compose: messaging")
  await install.bundle(
    {
      name: "pinger",
      description: "messages a teammate, for yuki verify",
      tools: { ping_mate: { description: "pings ben", effect: "message" }, peek_mate: { description: "tries to message from a read tool", effect: "read" } },
      calls: ["send_message"],
    },
    `export const tools = {
  async ping_mate(_a, yuki) { return await yuki.call("send_message", { to: "ben", text: "pinged by the extension" }) },
  async peek_mate(_a, yuki) { return await yuki.call("send_message", { to: "ben", text: "from a read tool" }) },
}`,
  )
  const before = messages(room).length
  await send(room, "@ana [ws ping_mate {}]")
  await until("ana's answer", () => messages(room).some((m) => m.from.kind === "agent" && m.text.includes("sent to")), 30_000).catch(() => {})
  await until("ben to receive it", () => messages(room).slice(before).some((m) => m.text.includes("pinged by the extension")), 30_000).catch(() => {})
  const log = messages(room).slice(before).map((m) => `${m.from.kind === "agent" ? `@${m.from.slug}` : m.from.kind}: ${m.text}`)
  const delivered = log.some((l) => l.includes("pinged by the extension") && l.startsWith("@ana"))
  const status = (await dev(v.url, s, "status", { roomId, slug: "ben" })) as { inbox: { waiting: number; claimed: number; submitted: number } }
  const received = status.inbox.waiting + status.inbox.claimed + status.inbox.submitted
  probe("P3a", delivered && received > 0 ? "VERIFIED" : "NOT VERIFIED", `message tool -> send_message: room log has it from ana: ${delivered}; ben's inbox holds ${received} envelope(s). log ${short(log.join(" | "))}`)
  const mark = messages(room).length
  await send(room, "@ana [ws peek_mate {}]")
  await until("ana's answer to the read tool", () => messages(room).slice(mark).some((m) => m.from.kind === "agent" && m.text.length > 0), 30_000).catch(() => {})
  const after = messages(room).slice(mark).map((m) => m.text)
  const refused = after.some((t) => /read" and cannot call send_message/.test(t))
  const leaked = after.some((t) => t.includes("from a read tool") && !/cannot call/.test(t))
  probe("P3b", refused && !leaked ? "VERIFIED" : "NOT VERIFIED", `read tool -> send_message ${refused ? "refused with the effect error" : "not refused"}: ${short(after.join(" | "))}`)
  room.raw.close()
}

async function p5(v: { url: string }, s: Session, install: Awaited<ReturnType<typeof installer>>) {
  await install.bundle(
    {
      name: "outbox",
      description: "two outside tools, for yuki verify",
      tools: { granted_send: { description: "sends outside, granted", effect: "external" }, ungranted_send: { description: "sends outside, not granted", effect: "external" } },
    },
    'export const tools = { async granted_send() { return "granted sent" }, async ungranted_send() { return "ungranted sent" } }',
  )
  const make = async (name: string, line: string, may: string[]) => {
    const { roomId, room } = await newRoom(s, `compose: routine ${name}`)
    await fake(v, s, roomId)
    const { routine } = await apiOk<{ routine: Routine }>(v.url, s, "routines", { roomId, name, instructions: line, may, trigger: { on: "time", at: inSeconds(3600) } })
    const stored = (await routines(v.url, s)).routines.find((r) => r.id === routine.id)
    await dev(v.url, s, "due", { id: routine.id })
    await waitRuns(v.url, s, routine.id, `${name} to run`, (rs) => rs.some((r) => r.status !== "running"), 45_000)
    await eventually(`${name} to post`, () => seen(room).live.length > 0, 15_000).catch(() => {})
    const said = seen(room).live.map((m) => m.text).join(" | ")
    room.raw.close()
    return { said, grant: stored?.grant ?? [] }
  }
  const granted = await make("granted", "[ws granted_send {}]", ["granted_send"])
  const ungranted = await make("ungranted", "[ws ungranted_send {}]", ["granted_send"])
  const grantedRan = granted.said.includes("granted sent") && granted.grant.includes("granted_send")
  const refused = ungranted.said.includes("needs the human's ok") && !ungranted.said.includes("ungranted sent")
  probe("P5", grantedRan && refused ? "VERIFIED" : "NOT VERIFIED", `a routine grant names an extension tool (stored grant ${JSON.stringify(granted.grant)}): granted run ${tail(granted.said)}; ungranted run ${tail(ungranted.said)}`)
}

const suite: Suite = {
  name: "extensions-compose",
  async run(v) {
    const s = await v.as(`ext-compose-${Date.now()}`)
    await fetch(new URL("api/me", base(v.url)), { headers: { cookie: s.cookie } })
    const install = await installer(s)
    for (const [id, run] of [["P1", p1], ["P2", p2], ["P3", p3], ["P5", p5]] as const) {
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
