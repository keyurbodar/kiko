import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// Architecture section 18.4. A real model turn with the `bash` tool over the chat's files. The human
// puts a csv and two notes in the chat over HTTP; the agent is asked to answer with one pipeline
// and save the result. The suite checks the answer, the saved file's bytes, and that the human's
// files are unchanged, so it passes only if the agent really ran bash over the room's files.

const TURN_MS = 120_000

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function ulid(): string {
  let time = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

type FileRef = { id: string; name: string; size: number; type: string }

function agentText(room: RoomHandle, from: number): string {
  return room.raw.log
    .slice(from)
    .flatMap((entry) => {
      const frame = entry.frame as RoomToClient
      if (entry.dir !== "in" || frame.t !== "events") return []
      return frame.events.flatMap((e) => (e.t === "message" && e.from.kind === "agent" ? [e.text] : []))
    })
    .join("\n")
}

const suite: Suite = {
  name: "bash",
  model: true,
  async run(v) {
    const s = await v.as(`bash-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const roomId = ulid()
    const base = new URL(`api/files/${roomId}/`, v.url.endsWith("/") ? v.url : `${v.url}/`)
    const user = await s.user()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "bash" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events")
    const put = async (path: string, body: string) => {
      const res = await fetch(new URL(`?path=${encodeURIComponent(path)}`, base), { method: "PUT", headers: { cookie: s.cookie, "content-type": "text/plain" }, body })
      if (!res.ok) throw new VerifyError(`put ${path} failed with ${res.status}: ${await res.text()}`)
    }

    // Random amounts, so only a real sum over the real file matches.
    const amounts = Array.from({ length: 12 }, () => 10 + Math.floor(Math.random() * 990))
    const total = amounts.reduce((a, b) => a + b, 0)
    const csv = `region,amount\n${amounts.map((a, i) => `r${i},${a}`).join("\n")}\n`
    await put("data/sales.csv", csv)
    await put("data/notes/a.md", "todo: book flights\nok\ntodo: pack\n")
    await put("data/notes/b.md", "todo: call the hotel\n")

    const from = room.raw.log.length
    const t0 = Date.now()
    room.send(
      "use the bash tool, one command: add up the amount column of /data/sales.csv, write just the number to /data/total.txt, " +
        "and count the lines containing todo across /data/notes. reply with the two numbers as: total <n>, todos <n>.",
    )
    const end = Date.now() + TURN_MS
    let said = ""
    while (!new RegExp(`total\\D{0,4}${total}`).test(said) || !/todos?\D{0,4}3\b/.test(said)) {
      if (Date.now() > end) throw new VerifyError(`the agent never said total ${total}, todos 3. it said: ${JSON.stringify(said)}`)
      await Bun.sleep(250)
      said = agentText(room, from).toLowerCase()
    }
    console.log(`  the agent answered in ${Date.now() - t0} ms: ${JSON.stringify(said)}`)

    const saved = room.raw.log.flatMap((entry) => {
      const frame = entry.frame as RoomToClient
      return entry.dir === "in" && frame.t === "events" ? frame.events.flatMap((e) => (e.t === "file" && e.file.name === "data/total.txt" ? [e.file as FileRef] : [])) : []
    })
    const file = saved.at(-1)
    if (!file) throw new VerifyError("the agent never saved /data/total.txt")
    const body = await (await fetch(new URL(file.id, base), { headers: { cookie: s.cookie } })).text()
    expectEqual(body.trim(), String(total), "the content of /data/total.txt")
    const kept = room.raw.log.some((entry) => {
      const frame = entry.frame as RoomToClient
      return entry.dir === "in" && frame.t === "events" && frame.events.some((e) => e.t === "file" && e.file.name === "data/sales.csv" && e.file.size !== csv.length)
    })
    if (kept) throw new VerifyError("the agent changed /data/sales.csv")
    console.log(`  /data/total.txt holds ${body.trim()}`)
    user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
