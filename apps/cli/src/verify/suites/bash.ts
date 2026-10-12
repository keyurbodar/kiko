import { agentText } from "../kit"
import { newRoomId } from "@yuki/protocol"
import type { RoomToClient } from "@yuki/protocol"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"


const TURN_MS = 120_000


type FileRef = { id: string; name: string; size: number; type: string }

const suite: Suite = {
  name: "bash",
  model: true,
  async run(v) {
    const s = await v.as(`bash-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const roomId = newRoomId()
    const base = new URL(`api/files/${roomId}/`, v.url)
    const user = await s.user()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "bash" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events")
    const put = async (path: string, body: string) => {
      const res = await s.putFile(roomId, path, body)
      if (!res.ok) throw new VerifyError(`put ${path} failed with ${res.status}: ${await res.text()}`)
    }

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
