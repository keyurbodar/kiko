import { ClientToUser, UserToClient } from "@yuki/protocol/schema"
import { Channel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const suite: Suite = {
  name: "selftest",
  async run(v) {
    const base = v.url.endsWith("/") ? v.url : `${v.url}/`
    const health = await fetch(new URL("api/health", base)).catch(() => null)
    if (!health?.ok) throw new VerifyError(`${v.url} is not healthy`)
    const a = await v.as("selftest-a")
    const again = await v.as("selftest-a")
    expectEqual(again.userId, a.userId, "the same dev name gives the same user")

    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return
        return new Response("ws only", { status: 400 })
      },
      websocket: {
        message(ws, raw) {
          const frame = JSON.parse(String(raw)) as { t: string }
          if (frame.t === "hello") ws.send(JSON.stringify({ t: "reset", snapshot: { seq: 0, chats: [], home: { files: [], folders: [] } } }))
          if (frame.t === "bogus") ws.send(JSON.stringify({ t: "nonsense" }))
        },
      },
    })
    const open = (label: string) =>
      new Channel(label, new URL(`ws://localhost:${server.port}/`), "", UserToClient, ClientToUser, {
        t: "hello",
        lastSeq: 0,
      })
    const channel = open("loop")
    const bad = open("loop-bad")
    try {
      await channel.connect()
      await channel.expect({ t: "reset", snapshot: { seq: 0 } }, 2000)
      await channel.reconnect()
      await channel.expect((f) => f.t === "reset", 2000)

      const timeout = await channel.expect({ t: "events" }, 150).then(
        () => "",
        (e: Error) => e.message,
      )
      if (!timeout.includes("timed out") || !timeout.includes("last ") || !timeout.includes('"t":"reset"')) {
        throw new VerifyError(`a timeout must print the frame log. got:\n${timeout}`)
      }

      let message = ""
      try {
        expectEqual({ a: 1, b: 2 }, { a: 1, b: 3 }, "sample")
      } catch (e) {
        message = (e as Error).message
      }
      if (!message.includes('-   "b": 3') || !message.includes('+   "b": 2')) {
        throw new VerifyError(`the diff must show both sides. got:\n${message}`)
      }

      await bad.connect()
      bad.sendRaw(JSON.stringify({ t: "bogus" }))
      const invalid = await bad.expect({ t: "events" }, 1000).then(
        () => "",
        (e: Error) => e.message,
      )
      if (!invalid.includes("invalid frame")) throw new VerifyError(`an invalid frame must be reported. got:\n${invalid}`)
    } finally {
      channel.close()
      bad.close()
      server.stop(true)
    }
  },
}

export default suite
