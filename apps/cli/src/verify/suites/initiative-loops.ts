import type { RoomToClient } from "@yuki/protocol"
import type { RoomHandle, Session, UserChannel } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { ulid } from "./mid-run"
import { dev } from "./team-loops"

// Architecture section 26. Open loops with the real model, once without a judge and once with Jev
// (TYPESAFE_API_KEY). INITIATIVE_MODE=nojev or jev runs one. Never prints a key.

const TYPESAFE = "typesafe"
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Loop = { id: number; kind: string; certainty: string; owner: string; room: string; status: string; text: string; source: string; due: string | null }

async function openChat(user: UserChannel, s: Session, title: string): Promise<RoomHandle & { id: string }> {
  const roomId = ulid()
  user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  await room.expect((f) => f.t === "events")
  return Object.assign(room, { id: roomId })
}

const frames = (room: RoomHandle) => room.raw.log.flatMap((e) => (e.dir === "in" ? [e.frame as RoomToClient] : []))
const idles = (room: RoomHandle) => frames(room).filter((f) => f.t === "status" && (f as { state: string }).state === "idle").length
const messages = (room: RoomHandle) => frames(room).flatMap((f) => (f.t === "events" ? f.events.flatMap((e) => (e.t === "message" ? [e] : [])) : []))

async function poll<T>(what: string, ms: number, test: () => Promise<T | false | null | undefined>): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const got = await test()
    if (got) return got
    if (Date.now() > end) throw new VerifyError(`timed out after ${ms / 1000}s waiting for ${what}`)
    await Bun.sleep(1_000)
  }
}

async function say(room: RoomHandle, text: string, ms = 120_000): Promise<string> {
  const before = idles(room)
  const seen = messages(room).length
  room.send(text)
  await poll(`an answer to ${JSON.stringify(text)}`, ms, async () => idles(room) > before)
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
  const user = await s.user()
  const base = v.url.endsWith("/") ? v.url : `${v.url}/`
  const loops = async () => ((await dev(v.url, s.cookie, "loops", {})) as { loops: Loop[] }).loops
  const reminders = async () => {
    const res = await fetch(new URL("api/reminders", base), { headers: { cookie: s.cookie } })
    if (!res.ok) throw new VerifyError(`GET api/reminders answered ${res.status}`)
    return (await res.json()) as { text: string; target: string }[]
  }
  const humanReminders = async () => (await reminders()).filter((r) => r.target === "human")
  const initiative = async (roomId: string) => ((await dev(v.url, s.cookie, "initiative", { roomId })) as { text: string | null }).text ?? ""
  const usage = async (roomId: string) => (await dev(v.url, s.cookie, "usage", { roomId })) as { agent: Record<string, number>; memory: Record<string, number> }
  const show = (l: Loop) => `L${l.id} ${l.status} ${l.kind}/${l.certainty} owner=${l.owner} via ${l.source}${l.due ? ` due ${l.due}` : ""}: ${l.text}`

  const work = await openChat(user, s, "work")
  let reply = await say(work, "Ugh, I have to submit the grant report to the foundation by Friday 5pm.")
  console.log(`  [${stamp()}] agent: ${reply.slice(0, 160)}`)
  const grant = await poll("an open explicit loop about the grant report", 60_000, async () => (await loops()).find((l) => l.status === "open" && l.certainty === "explicit" && /grant/i.test(l.text)))
  console.log(`  [${stamp()}] deadline -> ${show(grant)}`)
  if ((await humanReminders()).length) throw new VerifyError(`a stated deadline created a reminder nobody asked for: ${JSON.stringify(await reminders())}`)

  reply = await say(work, "Maybe I'll start running again at some point.")
  console.log(`  [${stamp()}] agent: ${reply.slice(0, 160)}`)
  const run = await poll("a tentative loop about running", 60_000, async () => (await loops()).find((l) => l.status === "open" && /run/i.test(l.text)))
  console.log(`  [${stamp()}] maybe -> ${show(run)}`)
  if (run.certainty !== "tentative") throw new VerifyError(`"maybe" became ${run.certainty}`)
  await Bun.sleep(jev ? 18_000 : 3_000)
  const asked = await humanReminders()
  if (asked.length) throw new VerifyError(`a tentative plan or deadline made a reminder: ${JSON.stringify(asked)}`)

  reply = await say(work, "No rush, but could you put together a beginner running plan for me and come back with it tomorrow? I am out the rest of today.")
  console.log(`  [${stamp()}] agent: ${reply.slice(0, 160)}`)
  console.log(`  [${stamp()}] reminders now: ${JSON.stringify((await reminders()).map((r) => `${r.target}: ${r.text}`))}`)
  const owed = await poll("a commitment loop the agent owns", 60_000, async () => (await loops()).find((l) => l.status === "open" && l.owner !== "human"))
  console.log(`  [${stamp()}] promise -> ${show(owed)}`)

  reply = await say(work, "Finally done with the grant report, sent it this morning!")
  console.log(`  [${stamp()}] agent: ${reply.slice(0, 160)}`)
  const brief = await initiative(work.id)
  console.log(`  [${stamp()}] that run started with:\n${brief.split("\n").map((l) => `      ${l}`).join("\n")}`)
  if (!/^you owe: /m.test(brief)) throw new VerifyError("the agent's next brief has no you owe line")
  const closed = await poll("the grant loop closed", 60_000, async () => (await loops()).find((l) => l.id === grant.id && l.status === "done"))
  console.log(`  [${stamp()}] done -> ${show(closed)}`)

  const home = await openChat(user, s, "personal")
  reply = await say(home, "Any tips for getting back into running again after a long break?")
  console.log(`  [${stamp()}] personal chat agent: ${reply.slice(0, 160)}`)
  const later = await initiative(home.id)
  console.log(`  [${stamp()}] personal chat run started with:\n${later.split("\n").map((l) => `      ${l}`).join("\n")}`)
  if (!/^related: .*run/im.test(later)) throw new VerifyError("the later chat's brief has no related line about running")
  if (/grant/i.test(later)) throw new VerifyError("a closed loop showed up as related")

  // The summary pass: the call that summarizes a page of turns also lists its loops. No extra call.
  const trip = await openChat(user, s, "trip")
  const chatter = ["what a week", "it was long, yes", "the weather turned cold", "time for soup then", "ha, maybe", "tomato is good", "we saw a film", "which one?", "an old western", "nice"]
  const turns = [
    { from: "human", text: "I have to renew my passport before the Japan trip in March." },
    { from: "yuki", text: "Got it. I will send you the visa checklist on Monday." },
    ...chatter.flatMap((t, i) => [{ from: i % 2 ? "yuki" : "human", text: t }]),
    { from: "human", text: "I am waiting to hear back from the landlord about the lease." },
    { from: "yuki", text: "Okay." },
    // A page is summarized once 48 turns sit after it (ROOM_SHAPE), so the chat goes on.
    ...Array.from({ length: 36 }, (_, i) => ({ from: i % 2 ? "yuki" : "human", text: `${chatter[i % chatter.length]} (${i})` })),
  ]
  const callsBefore = (await usage(trip.id)).memory.calls ?? 0
  await dev(v.url, s.cookie, "seed", { roomId: trip.id, turns })
  const napped = await poll("loops from the summary pass", 120_000, async () => {
    const got = (await loops()).filter((l) => l.source === "nap")
    return got.length >= 2 && got
  })
  console.log(`  [${stamp()}] summary pass -> ${napped.map(show).join("\n      ")}`)
  console.log(`  [${stamp()}] memory model calls during the pass: ${((await usage(trip.id)).memory.calls ?? 0) - callsBefore} (summaries only, no extra call)`)
  trip.raw.close()

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
