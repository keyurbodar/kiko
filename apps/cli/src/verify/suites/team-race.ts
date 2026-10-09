import type { FileRef, Message, RoomToClient } from "@yuki/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { until } from "./mid-run"

// Architecture section 7.12, with the real model. Two agents asked at once to change the same file
// used to race: the second write dropped the first. Now the first holds the file until its run
// ends, the second is told who holds it, and both changes survive.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ulid = () => {
  let t = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[t % 32] + head
    t = Math.floor(t / 32)
  }
  return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

function seen(room: RoomHandle): { messages: Message[]; files: Map<string, FileRef> } {
  const messages = new Map<string, Message>()
  const files = new Map<string, FileRef>()
  for (const entry of room.raw.log) {
    const f = entry.frame as RoomToClient
    if (entry.dir !== "in" || f.t !== "events") continue
    for (const e of f.events) {
      if (e.t === "message") messages.set(e.id, e)
      if (e.t === "file") files.set(e.file.name, e.file)
    }
  }
  return { messages: [...messages.values()].sort((a, b) => a.seq - b.seq), files }
}

async function quiet(room: RoomHandle, ms: number, cap: number) {
  const end = Date.now() + cap
  let n = room.raw.log.length
  let since = Date.now()
  while (Date.now() < end) {
    await Bun.sleep(250)
    if (room.raw.log.length !== n) {
      n = room.raw.log.length
      since = Date.now()
    } else if (Date.now() - since >= ms) return
  }
}

const suite: Suite = {
  name: "team-race",
  model: true,
  async run(v) {
    const s = await v.as(`race-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const ada = { id: `agent-ada-${Date.now()}`, name: "ada", slug: "ada" as never, prompt: "you write copy.", model: "" }
    user.send({ t: "agent", op: { op: "create", agent: ada } })
    const roomId = ulid()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "notes", agents: ["yuki", ada.id] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const t0 = Date.now()
    room.send("@all both of you, right now: add one line to /notes.md saying your own name and one food you like. create the file if it's not there. keep the other's line.")
    await until("a write to /notes.md", () => seen(room).files.has("notes.md"), 120_000)
    await quiet(room, 10_000, 180_000)
    const file = seen(room).files.get("notes.md")!
    const base = new URL(`api/files/${roomId}/`, v.url.endsWith("/") ? v.url : `${v.url}/`)
    const text = (await (await fetch(new URL(file.id, base), { headers: { cookie: s.cookie } })).text()).toLowerCase()
    console.log(`  /notes.md after ${Date.now() - t0} ms: ${JSON.stringify(text)}`)
    for (const m of seen(room).messages.filter((m) => m.from.kind === "agent")) console.log(`    @${(m.from as { slug: string }).slug}: ${m.text.replace(/\s+/g, " ").slice(0, 140)}`)
    const missing = ["yuki", "ada"].filter((n) => !text.includes(n))
    if (missing.length) throw new VerifyError(`a line was lost: no ${missing.join(", ")} in /notes.md`)
    room.raw.close()
  },
}

export default suite
