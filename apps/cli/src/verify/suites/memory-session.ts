import { idles } from "../kit"
import type { RoomToClient } from "@kiko/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { dev } from "./team-loops"


const TURNS = [
  "hi! one short line.",
  "my gym locker code is 4417, keep that in mind. just say ok.",
  "what's a good name for a houseplant? one short line.",
  "give me one word that means very happy.",
  "how do i keep basil alive on a windowsill? one short line.",
  "what's my gym locker code? just the number.",
]

type Trace = { kind: string; tool?: string; chars: number; text?: string }[]

const suite: Suite = {
  name: "memory-session",
  model: true,
  async run(v) {
    const s = await v.as(`memsession${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const roomId = `01K${Array.from({ length: 23 }, () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(Math.random() * 32)]).join("")}`
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "memory session" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const answers = () =>
      room.raw.log.flatMap((e) => {
        const f = e.frame as RoomToClient
        return e.dir === "in" && f.t === "events" ? f.events.flatMap((ev) => (ev.t === "message" && ev.from.kind === "agent" ? [ev.text] : [])) : []
      })
    for (const text of TURNS) {
      const before = idles(room)
      room.send(text)
      const end = Date.now() + 90_000
      while (idles(room) <= before) {
        if (Date.now() > end) throw new VerifyError(`no answer to ${JSON.stringify(text)}`)
        await Bun.sleep(300)
      }
      await Bun.sleep(800)
    }
    const last = answers().at(-1) ?? ""
    if (!last.includes("4417")) throw new VerifyError(`turn 6 did not answer from the conversation: ${JSON.stringify(last)}`)
    const trace = (await dev(v.url, s.auth, "trace", { roomId })) as Trace
    const turns: string[][] = []
    for (const e of trace) {
      if (e.kind === "pi.user") turns.push([])
      else if (e.tool) turns.at(-1)?.push(e.tool)
    }
    if (turns.length !== TURNS.length) throw new VerifyError(`expected ${TURNS.length} inputs in one transcript, saw ${turns.length}: the session started over`)
    console.log(`  tools per turn: ${JSON.stringify(turns)}`)
    for (const i of [0, 2, 3, 4]) if (turns[i]?.length) throw new VerifyError(`small talk at turn ${i + 1} called ${turns[i]?.join(", ")}`)
    const looked = turns[5]?.filter((t) => t === "recall" || t === "zoom")
    if (looked.length) throw new VerifyError(`turn 6 called ${looked.join(", ")} for a fact the conversation already had`)
    console.log(`  turn 6 answered ${JSON.stringify(last)} with no recall or zoom`)
    room.raw.close()
    user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
