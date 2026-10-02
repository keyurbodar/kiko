import type { RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P8-05, architecture sections 7.5 and 18. A real model turn with the room's file tools and
// `web_fetch`. Turn one: the agent writes `notes/plan.md`. The suite then changes that file and
// adds another over HTTP, as the human would, so the second turn can only answer right if the
// agent really read the file, listed the directory, and fetched the fixture page. The page sits
// on a local server; the dev Worker maps `fixture-<port>.preview.test` to it, and every fetch
// still goes through safeFetch.

const TURN_MS = 90_000

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

const word = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`

type FileRef = { id: string; name: string; size: number; type: string }

/** The agent's text since frame `from`, joined, from every bubble the room socket received. */
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

/** Waits until the agent's text since `from` holds every word. */
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
    const pageWord = word("kumquat")
    let fetched = 0
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== "/page") return new Response("no", { status: 404 })
        fetched++
        const html = `<html><head><title>fixture</title><script>var x = "not this"</script></head><body><h1>notice</h1><p>the code word is <b>${pageWord}</b>.</p></body></html>`
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
      },
    })
    try {
      const s = await v.as("file-tools")
      const roomId = ulid()
      const base = new URL(`api/files/${roomId}/`, v.url.endsWith("/") ? v.url : `${v.url}/`)
      const user = await s.user()
      user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "file tools" } })
      await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
      const room = await s.room(roomId)
      await room.expect((f) => f.t === "events")
      const put = async (path: string, body: string) => {
        const res = await fetch(new URL(`?path=${encodeURIComponent(path)}`, base), {
          method: "PUT",
          headers: { cookie: s.cookie, "content-type": "text/plain" },
          body,
        })
        if (!res.ok) throw new VerifyError(`put ${path} failed with ${res.status}: ${await res.text()}`)
      }

      // Turn one: write.
      const first = word("plan-")
      let from = room.raw.log.length
      room.send(`use the write_file tool to save notes/plan.md with exactly this content: ${first}\nthen reply with the word saved.`)
      const written = (await room.expect(
        (f) => f.t === "events" && f.events.some((e) => e.t === "file" && e.file.name === "notes/plan.md"),
        TURN_MS,
      )) as Extract<RoomToClient, { t: "events" }>
      const file = written.events.find((e) => e.t === "file")!.file as FileRef
      const download = await fetch(new URL(file.id, base), { headers: { cookie: s.cookie } })
      expectEqual(download.status, 200, "the download of the agent's file")
      expectEqual((await download.text()).trim(), first, "the content the agent wrote")
      expectEqual(file.type, "text/markdown", "the type of notes/plan.md")
      await answer(room, from, ["saved"])
      console.log(`  turn one: the agent wrote notes/plan.md (${file.size} bytes)`)

      // The human changes the plan and adds a file. Only a real read and a real list can see these.
      const second = word("revised-")
      const extra = `notes/${word("extra-")}.txt`
      await put("notes/plan.md", second)
      await put(extra, "an extra file")

      // Turn two: read, list, fetch.
      from = room.raw.log.length
      const url = `http://fixture-${server.port}.preview.test/page`
      room.send(
        `use read_file on notes/plan.md, list_files with prefix notes/, and web_fetch ${url}. ` +
          "reply with the content of notes/plan.md, every file path you listed, and the code word on the page. be brief.",
      )
      const said = await answer(room, from, [second, extra, pageWord])
      if (fetched < 1) throw new VerifyError("the fixture page was never fetched")
      if (said.includes("not this")) throw new VerifyError("the page's script reached the model as text")
      console.log(`  turn two: ${JSON.stringify(said)}`)
      user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
    } finally {
      server.stop(true)
    }
  },
}

export default suite
