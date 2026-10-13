import { poll } from "../kit"
import type { FileRef, Message, RoomToClient } from "@kiko/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { dev,  } from "./team-loops"
import { must } from "../must"


const PASTRY = "casa vidal"
const MEET = "yellow kiosk"

type Status = { inbox: { waiting: number; claimed: number; submitted: number } }

const suite: Suite = {
  name: "team-model",
  model: true,
  async run(v) {
    const s = await v.as(`teammodel-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const stamp = Date.now()
    const people = [
      { id: `agent-ada-${stamp}`, name: "ada", slug: "ada", prompt: `you plan food. you alone know the best pastry stop in lisbon: a shop called ${PASTRY}.` },
      { id: `agent-bob-${stamp}`, name: "bob", slug: "bob", prompt: `you plan routes. you alone know where the group meets: the ${MEET} at largo da graça.` },
    ]
    for (const p of people) user.send({ t: "agent", op: { op: "create", agent: { ...p, slug: p.slug as never, model: "" } } })
    const roomId = `01K${Array.from({ length: 23 }, () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(Math.random() * 32)]).join("")}`
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "lisbon day", agents: ["yuki", ...people.map((p) => p.id)] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const t0 = Date.now()
    room.send("@yuki write /walk.md: a one-day lisbon walk, five short lines. the pastry stop has to come from ada and the meeting point from bob, so get both from them first. then tell me it's done.")

    const files = () => {
      const out = new Map<string, FileRef & { at: number }>()
      for (const e of room.raw.log) {
        const f = e.frame as RoomToClient
        if (e.dir === "in" && f.t === "events") for (const ev of f.events) if (ev.t === "file") out.set(ev.file.name, { ...ev.file, at: ev.seq })
      }
      return out
    }
    const messages = () => {
      const out: Message[] = []
      for (const e of room.raw.log) {
        const f = e.frame as RoomToClient
        if (e.dir === "in" && f.t === "events") for (const ev of f.events) if (ev.t === "message") out.push(ev as Message)
      }
      return out
    }
    await poll("/walk.md", () => files().has("walk.md"), 240_000)
    await poll("kiko says it's done", () => messages().some((m) => m.from.kind === "agent" && m.from.slug === "yuki" && m.seq > (files().get("walk.md")?.at ?? 0)), 120_000).catch(() => {})
    await Bun.sleep(5_000)
    const file = must(files().get("walk.md"), "walk.md")
    const base = new URL(`api/files/${roomId}/`, v.url)
    const text = (await (await fetch(new URL(file.id, base), { headers: { cookie: s.cookie } })).text()).toLowerCase()
    console.log(`  /walk.md after ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(text)}`)
    for (const m of messages().filter((m) => m.from.kind === "agent")) console.log(`    @${(m.from as { slug: string }).slug}: ${m.text.replace(/\s+/g, " ").slice(0, 160)}`)
    const woken: Record<string, number> = {}
    for (const slug of ["yuki", "ada", "bob"]) {
      const st = (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status
      woken[slug] = st.inbox.waiting + st.inbox.claimed + st.inbox.submitted
    }
    console.log(`  envelopes each agent received: ${JSON.stringify(woken)}`)
    const missing = [PASTRY, MEET].filter((fact) => !text.includes(fact))
    if (missing.length) throw new VerifyError(`/walk.md lacks ${missing.join(" and ")}: kiko did not get it from its owner`)
    const over = Object.entries(woken).filter(([, n]) => n > 2)
    if (over.length) throw new VerifyError(`too many runs for one request: ${JSON.stringify(woken)}`)
    room.raw.close()
  },
}

export default suite
