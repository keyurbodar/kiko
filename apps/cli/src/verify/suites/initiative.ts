import { frames, idles, messages, newRoom, poll } from "../kit"
import type { Agent, AgentSlug, Message, } from "@yuki/protocol"
import type { RoomHandle, } from "../client"
import { connectTestModel, VerifyError } from "../client"
import { ok } from "../routine-kit"
import type { Suite } from "../runner"
import { dev } from "./team-loops"
import { must } from "../must"


const DAY = 86_400_000
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s`

export type Loop = { id: number; kind: string; certainty: string; owner: string; status: string; text: string; due: string | null }

export const humanLoop = (loops: readonly Loop[], topic: RegExp) => loops.find((l) => l.status === "open" && l.owner === "human" && topic.test(l.text))
type Verdict = { id: string; verdict: string; reason?: string; until?: number; text: string; target?: { slug: string } }
type Pass = { at: number; jev: boolean; verdicts: Verdict[]; woke: { id: string; to: string; result: string; ids: string[] }[] }
type Usage = { agent: { input: number; output: number }; memory: Record<string, number> }

const agentMessages = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent")
const runsOf = (ms: readonly Message[]) => new Set(ms.map((m) => m.run?.runId ?? m.id)).size

async function say(room: RoomHandle, text: string): Promise<string> {
  const before = idles(room)
  const seen = messages(room).length
  room.send(text)
  await poll(`an answer to ${JSON.stringify(text)}`, () => idles(room) > before, 150_000)
  await Bun.sleep(800)
  return messages(room)
    .slice(seen)
    .filter((m) => m.from.kind === "agent")
    .map((m) => m.text)
    .join(" / ")
}

async function settle(room: RoomHandle, still = 6_000, max = 150_000): Promise<void> {
  const end = Date.now() + max
  let last = room.raw.log.length
  let since = Date.now()
  while (Date.now() < end) {
    await Bun.sleep(1_000)
    const busy = (() => {
      const st = new Map<string, string>()
      for (const f of frames(room)) if (f.t === "status") st.set((f as { slug: string }).slug, (f as { state: string }).state)
      return [...st.values()].some((s) => s !== "idle")
    })()
    if (room.raw.log.length !== last || busy) {
      last = room.raw.log.length
      since = Date.now()
    } else if (Date.now() - since >= still) return
  }
}

const inDays = (n: number) => new Date(Date.now() + n * DAY).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })

type Arm = { label: string; jev: string | null; tokens: { agent: number; jev: number }; wakes: number; spoken: number }

async function user(v: Parameters<Suite["run"]>[0], arm: Arm, tag: string) {
  const s = await v.as(`init${tag}${arm.jev ? "j" : "n"}${Date.now().toString(36)}`)
  await connectTestModel(s)
  if (arm.jev) await s.connectProvider("typesafe", arm.jev)
  const channel = await s.user()
  const call = (body: unknown) => dev(v.url, s.cookie, "attention", body)
  return {
    s,
    channel,
    roll: async (roomId: string, text: string, due: string | null = null) => {
      if (!arm.jev) await dev(v.url, s.cookie, "loops", { open: { roomId, text, due } })
    },
    rhythm: () => call({ action: "rhythm", mode: "now" }),
    age: (ms: number) => call({ action: "age", ms }),
    pass: async () => {
      const p = (await call({ action: "pass" })) as Pass
      arm.wakes += p.woke.filter((w) => w.result === "delivered").length
      return p
    },
    state: async () => (await call({ action: "state" })) as { appetite: { user: { a: number; b: number }; kinds: Record<string, { a: number; b: number }> }; marks: unknown[] },
    loops: async () => ((await dev(v.url, s.cookie, "loops", {})) as { loops: Loop[] }).loops,
    usage: async (roomId: string, slug?: string) => (await dev(v.url, s.cookie, "usage", { roomId, ...(slug ? { slug } : {}) })) as Usage,
    brief: async (roomId: string) => ((await dev(v.url, s.cookie, "initiative", { roomId })) as { text: string | null }).text ?? "",
  }
}


const show = (p: Pass) => p.verdicts.map((x) => `${x.verdict}${x.reason ? `:${x.reason}` : ""}${x.target ? `->${x.target.slug}` : ""} "${x.text.slice(0, 50)}"`).join("; ") + (p.woke.length ? ` | woke ${p.woke.map((w) => `${w.to}:${w.result}`).join(", ")}` : "")
const spent = (u: Usage) => u.agent.input + u.agent.output
const jevTokens = (u: Usage) => (u.memory.jev_input ?? 0) + (u.memory.jev_output ?? 0)
const tagged = (room: RoomHandle) => agentMessages(room).filter((m) => m.initiative)
const files = (room: RoomHandle) => frames(room).flatMap((f) => (f.t === "events" ? f.events.filter((e) => e.t === "file") : [])).length

const only = (k: string) => !process.env.INITIATIVE_ONLY || process.env.INITIATIVE_ONLY.split(",").includes(k)

async function scenarios(v: Parameters<Suite["run"]>[0], arm: Arm): Promise<string[]> {
  const fails: string[] = []
  const check = (cond: boolean, what: string) => {
    console.log(`  ${cond ? "ok  " : "MISS"} [${stamp()}] ${what}`)
    if (!cond) fails.push(`${arm.label}: ${what}`)
  }
  const done = (room: RoomHandle) => {
    arm.spoken += runsOf(tagged(room))
    room.raw.close()
  }
  const cost =async (u: Awaited<ReturnType<typeof user>>, roomId: string, run: () => Promise<void>, slug?: string) => {
    const before = await u.usage(roomId, slug)
    await run()
    const after = await u.usage(roomId, slug)
    arm.tokens.agent += spent(after) - spent(before)
    arm.tokens.jev += jevTokens(after) - jevTokens(before)
    return spent(after) - spent(before)
  }

  if (only("d")) try {
    const u = await user(v, arm, "d")
    const room = (await newRoom(u.s, "trip")).room
    console.log(`       agent: ${(await say(room, `Heads up, I need to renew my US passport before my trip to Lisbon on ${inDays(10)}. Nothing to do right now.`)).slice(0, 140)}`)
    await u.roll(room.id, "I need to renew my US passport before my trip to Lisbon")
    const loop = await poll("an open passport loop", async () => humanLoop(await u.loops(), /passport/i), 60_000)
    await u.age(DAY)
    const before = agentMessages(room).length
    const p = await u.pass()
    await Bun.sleep(8_000)
    check(p.woke.length === 0 && agentMessages(room).length === before, `(d) no rhythm: no wake, no message (${show(p)})`)
    await say(room, "What should I pack for a week there?")
    const brief = await u.brief(room.id)
    check(brief.includes(`L${loop.id}`), `(d) the next run's brief carries the loop: ${JSON.stringify(brief.split("\n").filter((l) => l.includes(`L${loop.id}`)))}`)
    done(room)
  } catch (e) {
    check(false, `(d) stopped: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (only("a")) try {
    const u = await user(v, arm, "a")
    const room = (await newRoom(u.s, "work")).room
    const reply = await say(room, "No rush, but could you put together a short checklist for renewing a passport and come back with it tomorrow? I am out for the rest of today.")
    console.log(`       agent: ${reply.slice(0, 140)}`)
    const owed = await poll("a commitment the agent owns", async () => (await u.loops()).find((l) => l.status === "open" && l.owner !== "human"), 60_000)
    const before = agentMessages(room)
    await u.rhythm()
    let first = null as Pass | null
    const tokens = await cost(u, room.id, async () => {
      await u.age(DAY)
      await Bun.sleep(3_000)
      first = await u.pass()
      await settle(room)
    })
    const after = agentMessages(room).slice(before.length)
    console.log(`       pass 1: ${show(must(first, "pass 1"))}; follow-up: ${JSON.stringify(after.map((m) => m.text).join(" / ").slice(0, 200))} (${tokens} agent tokens)`)
    await u.age(DAY)
    const second = await u.pass()
    await settle(room)
    const total = agentMessages(room).slice(before.length)
    const loop = must((await u.loops()).find((l) => l.id === owed.id), "owed loop")
    console.log(`       pass 2: ${show(second)}; loop L${loop.id} is ${loop.status}`)
    check(runsOf(total) === 1, `(a) the promise was followed up by exactly one run (${runsOf(after)} then ${runsOf(total)} in all)`)
    done(room)
  } catch (e) {
    check(false, `(a) stopped: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (only("b")) try {
    const u = await user(v, arm, "b")
    const room = (await newRoom(u.s, "admin")).room
    await say(room, `I have to file my tax return by ${inDays(1)} at 6pm.`)
    await u.roll(room.id, "file my tax return", new Date(Date.now() + DAY).toISOString())
    const loop = await poll("an explicit tax loop", async () => humanLoop(await u.loops(), /tax/i), 60_000)
    console.log(`       loop: L${loop.id} ${loop.kind}/${loop.certainty} due ${loop.due}`)
    await u.rhythm()
    const wakes: number[] = []
    const rests: number[] = []
    let firstRest = 0
    const passes: Pass[] = []
    const step = async (ms: number) => {
      let p = null as Pass | null
      await cost(u, room.id, async () => {
        await u.age(ms)
        p = await u.pass()
        await settle(room)
      })
      passes.push(must(p, "pass"))
      const v0 = must(p, "pass").verdicts.find((x) => x.id === `loop:${loop.id}`)
      if (v0?.verdict === "rest" && v0.until && !firstRest) firstRest = passes.length
      if (v0?.verdict === "rest" && v0.until) rests.push(Math.round(((v0.until - must(p, "pass").at) / DAY) * 10) / 10)
      if (p?.woke.some((w) => w.result === "delivered" && w.ids.includes(`loop:${loop.id}`))) wakes.push(passes.length)
      console.log(`       age ${ms / DAY}d: ${show(must(p, "pass"))}; spoken so far ${runsOf(tagged(room))}`)
      return must(p, "pass")
    }
    await step(DAY / 2)
    while (runsOf(tagged(room)) < 2 && passes.length < 8) await step(2 * DAY)
    const spokenBefore = runsOf(tagged(room))
    const after = [await step(3 * DAY), await step(7 * DAY)]
    const spoke = tagged(room)
    const st = await u.state()
    console.log(`       wakes at passes ${JSON.stringify(wakes)}; spoken nudges ${runsOf(spoke)}: ${JSON.stringify(spoke.map((m) => `${m.initiative?.reason}: ${m.text.slice(0, 80)}`))}`)
    console.log(`       rest left at each resting pass (days): ${JSON.stringify(rests)}; appetite user ${JSON.stringify(st.appetite.user)}`)
    check(runsOf(spoke) <= 2, `(b) at most two spoken nudges in ${passes.length} passes over four weeks of silence (${runsOf(spoke)}; wakes ${wakes.length}, the rest were [skip])`)
    check(spokenBefore < 2 || after.every((p) => p.woke.length === 0), `(b) after two ignored nudges nothing wakes (${spokenBefore} spoken before: ${after.map(show).join(" / ")})`)
    const settled = rests.length >= 2 ? Math.max(...rests) > must(rests[0], "first rest") : wakes.every((w) => !firstRest || w < firstRest)
    check(settled, `(b) the rest grows, or nothing wakes after it: rests ${JSON.stringify(rests)} days, wakes ${wakes.length}`)
    if (process.env.INITIATIVE_TRACE) console.log(`       lead trace: ${JSON.stringify(await dev(v.url, u.s.cookie, "trace", { roomId: room.id }))}`)
    done(room)
  } catch (e) {
    check(false, `(b) stopped: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (only("c")) try {
    const u = await user(v, arm, "c")
    const room = (await newRoom(u.s, "health")).room
    await say(room, `I have to call the dentist to move my appointment, by ${inDays(1)} at noon.`)
    await u.roll(room.id, "call the dentist to move my appointment", new Date(Date.now() + DAY).toISOString())
    const loop = await poll("an explicit dentist loop", async () => humanLoop(await u.loops(), /dentist/i), 60_000)
    await u.rhythm()
    let p = null as Pass | null
    await cost(u, room.id, async () => {
      await u.age(DAY)
      p = await u.pass()
      await settle(room)
    })
    console.log(`       pass: ${show(must(p, "pass"))}; said: ${JSON.stringify(tagged(room).map((m) => m.text).join(" / ").slice(0, 200))}`)
    const reply = await say(room, "Please stop reminding me about the dentist. I will handle it myself.")
    console.log(`       agent: ${reply.slice(0, 140)}`)
    const dropped = await poll("the dentist loop closed", async () => (await u.loops()).find((l) => l.id === loop.id && l.status !== "open"), 60_000).catch(() => null)
    check(dropped?.status === "dropped", `(c) the loop is ${dropped?.status ?? "still open"}`)
    const before = tagged(room).length
    await u.age(3 * DAY)
    const after = await u.pass()
    await settle(room)
    check(!after.verdicts.some((x) => x.id === `loop:${loop.id}`) && tagged(room).length === before, `(c) no nudge after (${show(after) || "no candidates"})`)
    const st = await u.state()
    const kind = st.appetite.kinds[loop.kind]
    console.log(`       appetite kinds ${JSON.stringify(st.appetite.kinds)}`)
    if (runsOf(tagged(room)) > 0) check(kind !== undefined && kind.a === 0 && kind.b >= 5, `(c) the spoken nudge settled as dismissed, not engaged (${JSON.stringify(kind)})`)
    done(room)
  } catch (e) {
    check(false, `(c) stopped: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (only("e")) try {
    const u = await user(v, arm, "e")
    const agent = (name: string): Agent => ({ id: `init-${name}-${Date.now().toString(36)}`, name, slug: name as AgentSlug, prompt: "", model: "opencode-go/muse-spark-1.3-contributor" })
    const ada = agent("ada")
    const bob = agent("bob")
    for (const a of [ada, bob]) u.channel.send({ t: "agent", op: { op: "create", agent: a } })
    await Bun.sleep(500)
    const room = (await newRoom(u.s, "launch", [ada.id, bob.id])).room
    await say(room, "We are launching the site next week. Track the work here.")
    await settle(room)
    room.raw.send({ t: "task", op: { op: "create", id: "copy", title: "write the launch announcement", owner: "ada" as AgentSlug } })
    room.raw.send({ t: "task", op: { op: "update", id: "copy", status: "doing" } })
    await Bun.sleep(2_000)
    await u.rhythm()
    await dev(v.url, u.s.cookie, "age", { roomId: room.id, ms: 2 * DAY })
    await u.age(10 * 60_000)
    const before = agentMessages(room).length
    const filesBefore = files(room)
    let p: Pass | null = null as Pass | null
    await cost(
      u,
      room.id,
      async () => {
        p = await u.pass()
        await settle(room)
      },
      "ada",
    )
    const woke = p?.woke.find((w) => w.ids.some((id) => id.includes(":copy:")))
    const said = agentMessages(room).slice(before)
    console.log(`       pass: ${show(must(p, "pass"))}; said: ${JSON.stringify(said.map((m) => `@${(m.from as { slug: string }).slug}: ${m.text.slice(0, 80)}`))}`)
    check(woke?.to === "ada" && woke.result === "delivered", `(e) the stalled task woke @${woke?.to ?? "nobody"} (${woke?.result ?? "-"})`)
    check(said.length <= 1, `(e) the nudge is one message (${said.length} bubbles, ${files(room) - filesBefore} file changes)`)
    done(room)
  } catch (e) {
    check(false, `(e) stopped: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (only("f")) try {
    const u = await user(v, arm, "f")
    const room = (await newRoom(u.s, "errands")).room
    await say(room, `I have to pick up my new glasses by ${inDays(1)} at 5pm.`)
    await u.roll(room.id, "pick up my new glasses", new Date(Date.now() + DAY).toISOString())
    await poll("an open glasses loop", async () => humanLoop(await u.loops(), /glasses/i), 60_000)
    await u.rhythm()
    await u.age(DAY)
    await dev(v.url, u.s.cookie, "seen", { ago: 8 * DAY })
    const away = await u.pass()
    check(away.woke.length === 0 && away.verdicts.every((x) => x.verdict !== "nudge"), `(f) away 8 days: ${show(away)}`)
    await dev(v.url, u.s.cookie, "seen", { ago: 0 })
    await ok(v.url, u.s, "settings", { initiative: "off" })
    const off = await u.pass()
    await Bun.sleep(5_000)
    check(off.woke.length === 0 && tagged(room).length === 0, `(f) initiative off: ${show(off)}`)
    done(room)
  } catch (e) {
    check(false, `(f) stopped: ${e instanceof Error ? e.message : String(e)}`)
  }
  return fails
}

const suite: Suite = {
  name: "initiative",
  model: true,
  async run(v) {
    const mode = process.env.INITIATIVE_MODE ?? "both"
    const key = process.env.TYPESAFE_API_KEY ?? null
    const arms: Arm[] = []
    if (mode !== "jev") arms.push({ label: "no judge", jev: null, tokens: { agent: 0, jev: 0 }, wakes: 0, spoken: 0 })
    if (mode !== "nojev") {
      if (key) arms.push({ label: "jev", jev: key, tokens: { agent: 0, jev: 0 }, wakes: 0, spoken: 0 })
      else console.log("  TYPESAFE_API_KEY is not set: the Jev arm is skipped.")
    }
    const fails: string[] = []
    for (const arm of arms) {
      console.log(`  --- ${arm.label} ---`)
      fails.push(...(await scenarios(v, arm)))
      console.log(`  background tokens (${arm.label}): agent runs the engine started ${arm.tokens.agent}, Jev ${arm.tokens.jev}; wakes ${arm.wakes}, spoken nudges ${arm.spoken}`)
    }
    if (fails.length) throw new VerifyError(`${fails.length} miss(es):\n${fails.map((f) => `- ${f}`).join("\n")}`)
  },
}

export default suite
