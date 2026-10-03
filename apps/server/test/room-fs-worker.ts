import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ToolExecutionApi } from "@earendil-works/pi-durable"
import type { FileOp } from "@kiko/protocol"
import "../src/agent/effects"
import { filesExtension } from "../src/agent/extensions/files"
import { type FilesBackend, RoomFs, roomBackend, withSoul } from "../src/files/room-fs"
import { migrate } from "../src/user/schema"
import { Souls } from "../src/user/souls"
import type { Env } from "../src/index"
import { roomStub } from "../src/lib/names"

// The agent file tools against the real RoomDO and real R2 in workerd. `room-fs.test.ts` drives it.
//
//   POST /tool/<roomId>/<slug>   { name, args }   runs one tool as that agent
//   POST /op/<roomId>            FileOp           a human's `files` frame
//   GET  /keys/<roomId>                           the R2 keys of the room

export { RoomDO } from "../src/room/room-do"

/** The real soul store (user/souls.ts) over this object's SQLite. */
export class UserDO extends DurableObject {
  private readonly souls: Souls
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    migrate(ctx.storage.sql)
    this.souls = new Souls(ctx.storage.sql)
  }
  async recordRoom() {
    return true
  }
  soul(slug: string) {
    return this.souls.get(slug)
  }
  setSoul(slug: string, body: string, expectSha?: string) {
    return this.souls.set(slug, body, expectSha)
  }
}

/** One file system per agent, kept across requests as an agent process keeps it. */
const systems = new Map<string, RoomFs>()
/** Room calls and R2 reads per agent, so a test can pin how many a tool makes. */
const counts = new Map<string, { stat: number; get: number; put: number }>()

function counted(key: string, backend: FilesBackend, env: Env): FilesBackend {
  const c = { stat: 0, get: 0, put: 0 }
  counts.set(key, c)
  const get = env.FILES.get.bind(env.FILES)
  return {
    ...backend,
    stat: (p) => (c.stat++, backend.stat(p)),
    bytes: async (k, m) => {
      // Counts only the R2 reads the cache did not answer.
      const before = (env.FILES as unknown as { _gets?: number })._gets ?? 0
      const out = await backend.bytes(k, m)
      return (c.get += ((env.FILES as unknown as { _gets?: number })._gets ?? 0) - before), out
    },
    write: (...a) => (c.put++, backend.write(...a)),
  }
}

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
    if (kind === "counts") {
      const c = counts.get(`${roomId}/${slug}`)!
      const out = { ...c }
      c.stat = c.get = c.put = 0
      return Response.json(out)
    }
    if (kind === "op") return Response.json({ refused: await roomStub(env.ROOM, "alice", roomId!).fileOp((await request.json()) as FileOp) })
    const key = `${roomId}/${slug}`
    let fs = systems.get(key)
    if (!fs) {
      const home = { userId: "alice", roomId: roomId as never, slug: slug as never, role: "", lead: true }
      const files = env.FILES as unknown as { get: R2Bucket["get"]; _gets?: number }
      if (!("_gets" in files)) {
        const get = files.get.bind(env.FILES)
        files._gets = 0
        files.get = ((...a: Parameters<R2Bucket["get"]>) => (files._gets!++, get(...a))) as R2Bucket["get"]
      }
      // A stub per call: a stub made in one request cannot be used from another, as in AgentDO.
      const users = (env as unknown as { USER: DurableObjectNamespace<UserDO> }).USER
      const user = () => users.get(users.idFromName(`user:${roomId}`))
      const soul = { get: () => user().soul(slug!), set: (body: string, expect?: string) => user().setSoul(slug!, body, expect) }
      fs = new RoomFs(`test:${key}`, withSoul(counted(key, roomBackend(env, () => home), env), soul))
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
