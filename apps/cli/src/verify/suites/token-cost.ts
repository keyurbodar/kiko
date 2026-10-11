import { newRoomId, type RoomToClient } from "@yuki/protocol"
import { connectTestModel, type Verifier, VerifyError } from "../client"
import type { Suite } from "../runner"
import { dev } from "./team-loops"


const TURNS = Number(process.env.YUKI_TOKEN_TURNS ?? 30)
const CACHE_WEIGHT = 0.1

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }
type Spent = { agent: Usage; memory: Record<string, number> }

const LINES = [
  "can you suggest a quick lunch idea",
  "what's a good name for a houseplant",
  "remind me how long to boil an egg for jammy yolks",
  "i'm thinking of learning the guitar, any tip to start",
  "what's a nice short walk route idea for a rainy day",
  "give me one word that means very happy",
  "how do i keep basil alive on a windowsill",
  "what should i read next if i liked dune",
]

async function chat(v: Pick<Verifier, "url" | "as">, mode: "classic" | "memory") {
  const s = await v.as(`tokens-${mode}-${Date.now().toString(36)}`)
  await connectTestModel(s)
  const user = await s.user()
  const roomId = newRoomId()
  user.send({ t: "chat", op: { op: "create", roomId, title: `tokens ${mode}` } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  if (mode === "classic") await dev(v.url, s.cookie, "classic", { roomId })
  const idles = () =>
    room.raw.log.filter((e) => {
      const f = e.frame
      return e.dir === "in" && typeof f === "object" && f !== null && "t" in f && f.t === "status" && "state" in f && f.state === "idle"
    }).length
  const answers = () => {
    const out: string[] = []
    for (const e of room.raw.log) {
      const f = e.frame as RoomToClient
      if (e.dir === "in" && f.t === "events") for (const ev of f.events) if (ev.t === "message" && ev.from.kind === "agent") out.push(ev.text)
    }
    return out
  }
  const send = async (text: string) => {
    const before = idles()
    room.send(text)
    const end = Date.now() + 90_000
    while (idles() <= before) {
      if (Date.now() > end) throw new VerifyError(`${mode}: no answer to ${JSON.stringify(text)}`)
      await Bun.sleep(300)
    }
    await Bun.sleep(800)
  }
  const usage = async () => (await dev(v.url, s.cookie, "usage", { roomId })) as Spent
  const perRun: Usage[] = []
  let last: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (let i = 0; i < TURNS; i++) {
    const text = i === 2 ? "by the way my gym locker code is 4417, keep that in mind. just say ok." : `${LINES[i % LINES.length]}? one short line.`
    await send(text)
    const now = (await usage()).agent
    perRun.push({ input: now.input - last.input, output: now.output - last.output, cacheRead: now.cacheRead - last.cacheRead, cacheWrite: now.cacheWrite - last.cacheWrite })
    last = now
  }
  const asked = answers().length
  await send("what's my gym locker code? just the number.")
  const end = Date.now() + 180_000
  while (answers().length <= asked && Date.now() < end) await Bun.sleep(500)
  const recalled = answers().slice(asked).join(" ")
  if (!recalled) {
    const from = room.raw.log.length - 40
    for (const e of room.raw.log.slice(Math.max(0, from))) if (e.dir === "in") console.log(`    ${mode} event: ${JSON.stringify(e.frame).slice(0, 300)}`)
    console.log(`    ${mode} trace: ${JSON.stringify(await dev(v.url, s.cookie, "trace", { roomId })).slice(0, 2000)}`)
  }
  await Bun.sleep(mode === "memory" ? 60_000 : 0)
  const memory = (await usage()).memory
  room.raw.close()
  return { perRun, memory, recalled }
}

const sum = (runs: Usage[], k: keyof Usage) => runs.reduce((n, r) => n + r[k], 0)
const cost = (u: { input: number; cacheRead: number; output: number }, cache: number) => u.input + cache * u.cacheRead + 4 * u.output

const suite: Suite = {
  name: "token-cost",
  model: true,
  async run(v) {
    const modes = (process.env.YUKI_TOKEN_MODES ?? "classic,memory").split(",") as ("classic" | "memory")[]
    const results: Partial<Record<"classic" | "memory", Awaited<ReturnType<typeof chat>>>> = {}
    for (const m of modes) results[m] = await chat(v, m)
    for (const [mode, r] of Object.entries(results) as [string, NonNullable<(typeof results)["memory"]>][]) {
      const first = r.perRun.slice(0, 5)
      const lastFive = r.perRun.slice(-5)
      const per = (runs: Usage[], k: keyof Usage) => Math.round(sum(runs, k) / runs.length)
      console.log(`  ${mode}: requests' fresh input ${per(first, "input")} -> ${per(lastFive, "input")}, cached ${per(first, "cacheRead")} -> ${per(lastFive, "cacheRead")}, output ${per(lastFive, "output")} (first 5 runs -> last 5)`)
      console.log(`  ${mode}: total fresh ${sum(r.perRun, "input")}, cached ${sum(r.perRun, "cacheRead")}, output ${sum(r.perRun, "output")}; summaries ${JSON.stringify(r.memory)}`)
      const agent = { input: sum(r.perRun, "input"), cacheRead: sum(r.perRun, "cacheRead"), output: sum(r.perRun, "output") }
      const summaries = { input: r.memory.input ?? 0, cacheRead: r.memory.cacheRead ?? 0, output: r.memory.output ?? 0 }
      console.log(`  ${mode}: cost with cache at 10%: agent ${Math.round(cost(agent, CACHE_WEIGHT))} + summaries ${Math.round(cost(summaries, CACHE_WEIGHT))}; at 2%: agent ${Math.round(cost(agent, 0.02))} + summaries ${Math.round(cost(summaries, 0.02))}; turn 2 recalled: ${JSON.stringify(r.recalled)}`)
    }
    if (results.memory && !results.memory.recalled.includes("4417")) throw new VerifyError("memory mode lost the fact from turn 2")
  },
}

export default suite
