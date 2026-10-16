import { idles, messages, newRoom, poll } from "../kit"
import type { RoomHandle, } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { dev } from "./team-loops"


const TYPESAFE = "typesafe"
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Loop = { id: number; kind: string; owner: string; room: string; status: string; text: string; source: string; due: string | null }


async function say(room: RoomHandle, text: string, ms = 120_000): Promise<string> {
  const before = idles(room)
  const seen = messages(room).length
  room.send(text)
  await poll(`an answer to ${JSON.stringify(text)}`, async () => idles(room) > before, ms)
  await Bun.sleep(500)
  return messages(room)
    .slice(seen)
    .filter((m) => m.from.kind === "agent")
    .map((m) => m.text)
    .join(" / ")
}

async function phase(v: Parameters<Suite["run"]>[0], jev: string | null): Promise<void> {
  const label = jev ? "jev" : "no judge"
  console.log(`  --- ${label} ---`)
  const s = await v.as(`initloops${jev ? "j" : "n"}${Date.now().toString(36)}`)
  await connectTestModel(s)
  if (jev) await s.connectProvider(TYPESAFE, jev)
  const base = v.url
  const loops = async () => ((await dev(v.url, s.auth, "loops", {})) as { loops: Loop[] }).loops
  const reminders = async () => {
    const res = await fetch(new URL("api/routines", base), { headers: { authorization: s.auth } })
    if (!res.ok) throw new VerifyError(`GET api/routines answered ${res.status}`)
    return ((await res.json()) as { routines: { text: string; target: string }[] }).routines
  }
  const initiative = async (roomId: string) => ((await dev(v.url, s.auth, "initiative", { roomId })) as { text: string | null }).text ?? ""
  const usage = async (roomId: string) => (await dev(v.url, s.auth, "usage", { roomId })) as { agent: Record<string, number>; memory: Record<string, number> }
  const show = (l: Loop) => `L${l.id} ${l.status} ${l.kind} owner=${l.owner} via ${l.source}${l.due ? ` due ${l.due}` : ""}: ${l.text}`

  const work = (await newRoom(s, "work")).room
  for (const text of [
    "Ugh, I have to submit the grant report to the foundation by Friday 5pm.",
    "Maybe I'll start running again at some point.",
    "No rush, but could you put together a beginner running plan for me and come back with it tomorrow? I am out the rest of today.",
  ]) {
    const reply = await say(work, text)
    console.log(`  [${stamp()}] agent: ${reply.slice(0, 160)}`)
  }
  const grant = await poll("an open loop about the grant report", async () => (await loops()).find((l) => l.status === "open" && /grant/i.test(l.text)), 90_000)
  console.log(`  [${stamp()}] deadline -> ${show(grant)}`)
  await Bun.sleep(3_000)
  console.log(`  [${stamp()}] loops so far:\n${(await loops()).map((l) => `      ${show(l)}`).join("\n")}`)
  console.log(`  [${stamp()}] memory ${JSON.stringify((await usage(work.id)).memory)}`)
  const owed = await poll("a commitment loop the agent owns", async () => (await loops()).find((l) => l.status === "open" && l.owner !== "human"), 30_000)
  console.log(`  [${stamp()}] promise -> ${show(owed)}`)
  console.log(`  [${stamp()}] reminders now: ${JSON.stringify((await reminders()).map((r) => `${r.target}: ${r.text}`))}`)
  const asked = await reminders()
  if (asked.length) throw new VerifyError(`a deadline made a routine: ${JSON.stringify(asked)}`)

  let reply = await say(work, "Finally done with the grant report, sent it this morning!")
  console.log(`  [${stamp()}] agent: ${reply.slice(0, 160)}`)
  const brief = await initiative(work.id)
  console.log(`  [${stamp()}] that run started with:\n${brief.split("\n").map((l) => `      ${l}`).join("\n")}`)
  if (!/^you owe: /m.test(brief)) throw new VerifyError("the agent's next brief has no you owe line")
  const closed = await poll("the grant loop closed", async () => (await loops()).find((l) => l.id === grant.id && l.status === "done"), 60_000)
  console.log(`  [${stamp()}] done -> ${show(closed)}`)

  const home = (await newRoom(s, "personal")).room
  reply = await say(home, "Any tips for getting back into running again after a long break?")
  console.log(`  [${stamp()}] personal chat agent: ${reply.slice(0, 160)}`)
  const later = await initiative(home.id)
  console.log(`  [${stamp()}] personal chat run started with:\n${later.split("\n").map((l) => `      ${l}`).join("\n")}`)
  if (!/^related: .*run/im.test(later)) throw new VerifyError("the later chat's brief has no related line about running")
  if (/grant/i.test(later)) throw new VerifyError("a closed loop showed up as related")

  console.log(`  [${stamp()}] all loops:\n${(await loops()).map((l) => `      ${show(l)}`).join("\n")}`)
  const [a, b] = [await usage(work.id), await usage(home.id)]
  console.log(`  [${stamp()}] usage work agent ${JSON.stringify(a.agent)}, personal agent ${JSON.stringify(b.agent)}`)
  console.log(`  [${stamp()}] usage memory ${JSON.stringify(b.memory)}`)
  if (!jev && (b.memory.loops_jev ?? 0) !== 0) throw new VerifyError("Jev ran with no judge")
  if (jev && !((b.memory.loops_jev ?? 0) >= 1)) throw new VerifyError(`loops_jev is ${b.memory.loops_jev ?? 0} with a judge`)
  work.raw.close()
  home.raw.close()
}

const suite: Suite = {
  name: "initiative-loops",
  model: true,
  async run(v) {
    const mode = process.env.INITIATIVE_MODE ?? "both"
    const jev = process.env.TYPESAFE_API_KEY ?? null
    if (mode !== "jev") await phase(v, null)
    if (mode !== "nojev") {
      if (!jev) console.log("  TYPESAFE_API_KEY is not set: the Jev phase is skipped.")
      else await phase(v, jev)
    }
  },
}

export default suite
