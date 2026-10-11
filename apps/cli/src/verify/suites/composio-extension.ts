import type { ClientToUser, ExtensionOp, ExtensionResult, RoomToClient } from "@yuki/protocol"
import { connectTestModel, type RoomHandle, VerifyError } from "../client"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { newRoom } from "./mid-run"

const MODEL = "opencode-go/muse-spark-1.3-contributor"
type Events = Extract<RoomToClient, { t: "events" }>
type Status = Extract<RoomToClient, { t: "status" }>

const WEB = `export const tools = {
  async web_lookup({ query }, yuki) {
    const out = await yuki.call("composio_multi_execute_tool", { tools: [{ tool_slug: "COMPOSIO_SEARCH_WEB", arguments: { query } }], sync_response_to_workbench: false, thought: "extension lookup" })
    return String(out).slice(0, 1500)
  },
}
`

const suite: Suite = {
  name: "composio-extension",
  model: true,
  async run(v) {
    const key = process.env.COMPOSIO_API_KEY
    if (!key) throw new VerifyError("COMPOSIO_API_KEY is not set")
    const s = await v.as(`composio-ext-${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const composio = async (frame: Record<string, unknown>) => {
      const reqId = `c${++n}`
      user.send({ ...frame, reqId } as unknown as ClientToUser)
      return ((await user.expect((f) => (f as { t: string; reqId?: string }).t === "composio" && (f as { reqId?: string }).reqId === reqId, 60_000)) as unknown as { result: { ok: boolean; error?: string } }).result
    }
    const op = async (o: ExtensionOp): Promise<ExtensionResult> => {
      const reqId = `e${++n}`
      user.send({ t: "extension", reqId, op: o })
      return ((await user.expect((f) => f.t === "extension_result" && f.reqId === reqId, 10_000)) as { result: ExtensionResult }).result
    }
    const connected = await composio({ t: "connectComposio", apiKey: key })
    if (!connected.ok) throw new VerifyError(`connect: ${connected.error}`)

    const turn = async (room: RoomHandle, text: string) => {
      const clientId = room.send(text)
      await room.expect({ t: "ack", clientId })
      let out = ""
      let got = false
      for (;;) {
        const f = await room.expect((x) => (x.t === "status" && (x as Status).state === "idle" && got) || (x.t === "events" && (x as Events).events.some((e) => e.t === "message" && e.from.kind === "agent")), 150_000)
        if (f.t === "status") break
        got = true
        for (const e of (f as Events).events) if (e.t === "message" && e.from.kind === "agent") out += `${e.text} / `
      }
      return out
    }
    const tools = async () => Object.keys(await readStats(v, s)).filter((k) => /^composio\.[^.]+\.ms$/.test(k)).map((k) => k.split(".")[1])

    const a = await newRoom(s, "composio yes")
    a.room.raw.send({ t: "model", ref: MODEL })
    await Bun.sleep(500)
    await resetStats(v, s)
    console.log(`  ask: ${(await turn(a.room, "Use Composio to search the web: what is the latest stable Bun version? Answer in one line.")).slice(0, 300)}`)
    console.log(`  tools after ask: ${(await tools()).join(" ")}`)
    console.log(`  after yes: ${(await turn(a.room, "yes, go ahead")).slice(0, 300)}`)
    console.log(`  tools after yes: ${(await tools()).join(" ")}`)

    const p = await op({ op: "propose", bundle: { manifest: { yuki: 1, name: "web-lookup", version: "1.0.0", description: "web lookups through composio", tools: { web_lookup: { description: "search the web through composio and return the raw result", effect: "external", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }, calls: ["composio_multi_execute_tool"] }, files: { "main.js": WEB } } })
    if (!p.ok) throw new VerifyError(`propose: ${p.error} ${p.problems?.join("; ")}`)
    const i = await op({ op: "install", id: p.proposal!.id })
    if (!i.ok) throw new VerifyError(`install: ${i.error}`)
    const b = await newRoom(s, "extension calls composio")
    b.room.raw.send({ t: "model", ref: MODEL })
    await Bun.sleep(500)
    await resetStats(v, s)
    console.log(`  ext reply: ${(await turn(b.room, "use web_lookup to find who created the Deno runtime. one line.")).slice(0, 400)}`)
    console.log(`  tools via ext: ${(await tools()).join(" ")}`)
  },
}

export default suite
