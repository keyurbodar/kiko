import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ToolExecutionApi } from "@earendil-works/pi-durable"
import type { FileOp } from "@kiko/protocol"
import "../src/agent/effects"
import { filesExtension } from "../src/agent/extensions/files"
import { RoomFs, roomBackend } from "../src/files/room-fs"
import type { Env } from "../src/index"
import { roomStub } from "../src/lib/names"

// The agent file tools against the real RoomDO and real R2 in workerd. `room-fs.test.ts` drives it.
//
//   POST /tool/<roomId>/<slug>   { name, args }   runs one tool as that agent
//   POST /op/<roomId>            FileOp           a human's `files` frame
//   GET  /keys/<roomId>                           the R2 keys of the room

export { RoomDO } from "../src/room/room-do"

export class UserDO extends DurableObject {
  async recordRoom() {
    return true
  }
}

/** One file system per agent, kept across requests as an agent process keeps it. */
const systems = new Map<string, RoomFs>()

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, slug] = new URL(request.url).pathname.split("/")
    if (kind === "keys") {
      const page = await env.FILES.list({ prefix: "" })
      return Response.json(page.objects.map((o) => o.key).filter((k) => k.includes(roomId!)))
    }
    if (kind === "raw") {
      // Bytes as an upload would store them, through the same backend.
      const url = new URL(request.url)
      const home = { userId: "alice", roomId: roomId as never, slug: "human" as never, role: "", lead: true }
      const fs = new RoomFs("raw", roomBackend(env, () => home))
      const out = await fs.write(url.searchParams.get("path")!, new Uint8Array(await request.arrayBuffer()), url.searchParams.get("type")!)
      return Response.json({ ok: out.ok })
    }
    if (kind === "op") return Response.json({ refused: await roomStub(env.ROOM, "alice", roomId!).fileOp((await request.json()) as FileOp) })
    const key = `${roomId}/${slug}`
    let fs = systems.get(key)
    if (!fs) {
      const home = { userId: "alice", roomId: roomId as never, slug: slug as never, role: "", lead: true }
      fs = new RoomFs(`test:${key}`, roomBackend(env, () => home))
      systems.set(key, fs)
    }
    const { name, args } = (await request.json()) as { name: string; args: Record<string, unknown> }
    const tool = (filesExtension({ fs, acceptsImages: () => slug === "seer" }).tools ?? []).find((t) => t.name === name)
    if (!tool) return Response.json({ error: `no tool ${name}` }, { status: 404 })
    const api = { env: fs, agent: async () => ({ model: { provider: "faux", modelId: "faux-1" } }), conversationId: "c1", callId: crypto.randomUUID() } as unknown as ToolExecutionApi
    const started = performance.now()
    try {
      const result = await tool.execute(args as never, api, BACKGROUND_CONTEXT)
      const text = (result.content ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("")
      const notes = (result.diagnostics ?? []).map((d) => d.message).join("\n")
      return Response.json({ ok: !result.isError, text, notes, ms: performance.now() - started })
    } catch (error) {
      return Response.json({ ok: false, text: error instanceof Error ? error.message : String(error), ms: performance.now() - started })
    }
  },
}
