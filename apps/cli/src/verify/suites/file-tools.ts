import { agentText } from "../kit"
import { newRoomId } from "@kiko/protocol"
import { createHash } from "node:crypto"
import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { must } from "../must"


const TURN_MS = 90_000


const word = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`

type FileRef = { id: string; name: string; size: number; type: string }

function filesNow(room: RoomHandle): Map<string, FileRef> {
  const byId = new Map<string, FileRef>()
  for (const entry of room.raw.log) {
    const frame = entry.frame as RoomToClient
    if (entry.dir !== "in") continue
    if (frame.t === "reset") for (const f of frame.snapshot.files) byId.set(f.id, f)
    if (frame.t !== "events") continue
    for (const e of frame.events) {
      if (e.t === "file") {
        for (const [id, f] of byId) if (f.name === e.file.name && id !== e.file.id) byId.delete(id)
        byId.set(e.file.id, e.file)
      }
      if (e.t === "file_removed") for (const id of e.ids) byId.delete(id)
    }
  }
  return new Map([...byId.values()].map((f) => [f.name, f]))
}

async function answer(room: RoomHandle, from: number, words: string[]): Promise<string> {
  const end = Date.now() + TURN_MS
  for (;;) {
    const text = agentText(room, from)
    if (words.every((w) => text.toLowerCase().includes(w.toLowerCase()))) return text
    if (Date.now() > end) throw new VerifyError(`the agent never said ${words.join(", ")}. it said: ${JSON.stringify(text)}`)
    await Bun.sleep(250)
  }
}

const suite: Suite = {
  name: "file-tools",
  model: true,
  async run(v) {
    const s = await v.as(`file-tools-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const roomId = newRoomId()
    const base = new URL(`api/files/${roomId}/`, v.url)
    const user = await s.user()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "file tools" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events")
    const put = async (path: string, body: string, expect = "none") => {
      const res = await s.putFile(roomId, path, body, { expect })
      if (!res.ok) throw new VerifyError(`put ${path} failed with ${res.status}: ${await res.text()}`)
    }

    const first = word("plan-")
    let from = room.raw.log.length
    let t0 = Date.now()
    room.send(`use the write tool to save /notes/plan.md with exactly this content: ${first}\nthen reply with the word saved.`)
    const written = (await room.expect(
      (f) => f.t === "events" && f.events.some((e) => e.t === "file" && e.file.name === "notes/plan.md"),
      TURN_MS,
    )) as Extract<RoomToClient, { t: "events" }>
    const file = written.events.find((e) => e.t === "file")?.file as FileRef
    const download = await fetch(new URL(file.id, base), { headers: { authorization: s.auth } })
    expectEqual(download.status, 200, "the download of the agent's file")
    const loaded = new Uint8Array(await download.arrayBuffer())
    expectEqual(new TextDecoder().decode(loaded).trim(), first, "the content the agent wrote")
    expectEqual(file.type, "text/markdown", "the type of notes/plan.md")
    await answer(room, from, ["saved"])
    console.log(`  turn one: the agent wrote notes/plan.md (${file.size} bytes) in ${Date.now() - t0} ms`)

    const second = word("revised-")
    const extra = `notes/${word("extra-")}.txt`
    await put("notes/plan.md", second, createHash("sha256").update(loaded).digest("hex"))
    await put(extra, "an extra file")

    from = room.raw.log.length
    room.send("read /notes/plan.md and ls /notes. reply with the content of notes/plan.md and every file path you listed. be brief.")
    const said = await answer(room, from, [second, extra])
    console.log(`  turn two: ${JSON.stringify(said)}`)

    const third = word("final-")
    from = room.raw.log.length
    t0 = Date.now()
    room.send(
      `in /notes/plan.md replace ${second} with ${third} (use edit, not write). then move the whole /notes folder to /archive, ` +
        `copy /archive/plan.md to /final.md, and delete the ${extra.slice(6)} file. reply done when all four are done.`,
    )
    await answer(room, from, ["done"])
    const end = Date.now() + 20_000
    const want = ["archive/plan.md", "final.md"]
    let now = filesNow(room)
    while (Date.now() < end && !(want.every((p) => now.has(p)) && ![...now.keys()].some((p) => p.startsWith("notes/") || p.endsWith(extra.slice(6))))) {
      await Bun.sleep(250)
      now = filesNow(room)
    }
    const paths = [...now.keys()].sort()
    expectEqual(JSON.stringify(paths), JSON.stringify(want), "the files after edit, mv, cp, and rm")
    for (const path of want) {
      const res = await fetch(new URL(must(now.get(path), "file ref").id, base), { headers: { authorization: s.auth } })
      expectEqual((await res.text()).trim(), third, `the content of ${path}`)
    }
    console.log(`  turn three: edit, mv, cp, rm in ${Date.now() - t0} ms. files: ${paths.join(", ")}`)

    from = room.raw.log.length
    t0 = Date.now()
    room.send("keep a copy of /final.md in my drive as /home/plan.md so i have it in other chats. reply kept.")
    await answer(room, from, ["kept"])
    const noticed = room.raw.log.slice(from).some((entry) => {
      const f = entry.frame as RoomToClient
      return entry.dir === "in" && f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "system" && /saved \/home\/plan\.md/.test(e.text))
    })
    if (!noticed) throw new VerifyError("no line in the chat says the agent saved /home/plan.md")
    const home = await fetch(new URL("api/files/home/", v.url), { headers: { authorization: s.auth } }).catch(() => null)
    void home
    console.log(`  turn four: copied to /home/plan.md in ${Date.now() - t0} ms, and the chat said so`)
    user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
