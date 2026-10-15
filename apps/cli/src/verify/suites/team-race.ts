import { poll } from "../kit"
import { newRoomId } from "@kiko/protocol"
import type { FileRef, Message, RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, VerifyError } from "../client"
import { must } from "../must"
import type { Suite } from "../runner"



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
    const roomId = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "notes", agents: ["kiko", ada.id] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const t0 = Date.now()
    room.send("@all both of you, right now: add one line to /notes.md saying your own name and one food you like. create the file if it's not there. keep the other's line.")
    await poll("a write to /notes.md", () => seen(room).files.has("notes.md"), 120_000)
    await quiet(room, 10_000, 180_000)
    const file = must(seen(room).files.get("notes.md"), "the notes.md file")
    const base = new URL(`api/files/${roomId}/`, v.url)
    const text = (await (await fetch(new URL(file.id, base), { headers: { authorization: s.auth } })).text()).toLowerCase()
    console.log(`  /notes.md after ${Date.now() - t0} ms: ${JSON.stringify(text)}`)
    for (const m of seen(room).messages.filter((m) => m.from.kind === "agent")) console.log(`    @${(m.from as { slug: string }).slug}: ${m.text.replace(/\s+/g, " ").slice(0, 140)}`)
    const missing = ["kiko", "ada"].filter((n) => !text.includes(n))
    if (missing.length) throw new VerifyError(`a line was lost: no ${missing.join(", ")} in /notes.md`)
    room.raw.close()
  },
}

export default suite
