import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ToolExecutionApi } from "@earendil-works/pi-durable"
import type { FileOp } from "@kiko/protocol"
import "../src/agent/effects"
import { filesExtension } from "../src/agent/extensions/files"
import { type FilesBackend, HOME_PATH, homeBackend, RoomFs, roomBackend, withMount, withSoul } from "../src/files/room-fs"
import { FileIndex, HOME_TABLES, type IndexChange, type NewFile } from "../src/files/file-index"
import { actorKey } from "../src/room/log"
import type { Actor } from "@kiko/protocol"
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

/** The real soul store (user/souls.ts) and drive index (files/file-index.ts) over this object's SQLite. */
export class UserDO extends DurableObject {
  private readonly souls: Souls
  private readonly home: FileIndex<unknown>
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    migrate(ctx.storage.sql)
    this.souls = new Souls(ctx.storage.sql)
    this.home = new FileIndex<unknown>(ctx.storage, HOME_TABLES, (_, body) => body, actorKey)
  }
  homePut(input: NewFile) {
    const { events, ...result } = this.home.put(input)
    return { ...result, fresh: events.length > 0, entry: result.file && !result.conflict ? this.home.stat(input.path) : null }
  }
  homeStat(path: string) {
    return this.home.stat(path)
  }
  homeList(dir: string, recursive = false) {
    return this.home.list(dir, recursive)
  }
  homeMove(by: Actor, from: string, to: string) {
    return this.home.move(from, to, by)
  }
  homeRemove(by: Actor, paths: string[], recursive: boolean) {
    return this.home.remove(paths, recursive, by)
  }
  homeMkdir(by: Actor, path: string) {
    return this.home.mkdir(path, by)
  }
  homeCommit(by: Actor, changes: IndexChange[]) {
    return this.home.commit(changes, by)
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

/** What agents told the chat about the drive. */
const notices: string[] = []

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
    if (kind === "idle") {
      // The agent's run ended: the room lets go of what it held.
      await roomStub(env.ROOM, "alice", roomId!).setStatus(slug as never, "idle")
      return Response.json({ ok: true })
    }
    if (kind === "notices") return Response.json(notices.splice(0))
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
      // One user, alice, in every room: the drive and the souls are hers.
      const user = () => users.get(users.idFromName("user:alice"))
      const soul = { get: () => user().soul(slug!), set: (body: string, expect?: string) => user().setSoul(slug!, body, expect) }
      // An agent named "quiet" works in a private chat: the drive is read-only for it.
      const drive = homeBackend(env, () => home, async (text) => void notices.push(`@${slug} ${text}`), undefined, () => (slug === "quiet" ? "this chat is private" : null))
      fs = new RoomFs(`test:${key}`, withSoul(withMount(counted(key, roomBackend(env, () => home), env), HOME_PATH, drive), soul))
      systems.set(key, fs)
    }
    const { name, args } = (await request.json()) as { name: string; args: Record<string, unknown> }
    const tool = (filesExtension({ fs, acceptsImages: () => slug === "seer" }).tools ?? []).find((t) => t.name === name)
    if (!tool) return Response.json({ error: `no tool ${name}` }, { status: 404 })
    // What a tool streams (bash) reaches `output`, as the harness keeps it.
    let streamed = ""
    const api = { env: fs, agent: async () => ({ model: { provider: "faux", modelId: "faux-1" } }), conversationId: "c1", callId: crypto.randomUUID(), output: (t: string) => void (streamed += t), diagnostic: () => {} } as unknown as ToolExecutionApi
    const started = performance.now()
    try {
      const result = await tool.execute(args as never, api, BACKGROUND_CONTEXT)
      const text = (result.content ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("") || streamed
      const notes = (result.diagnostics ?? []).map((d) => d.message).join("\n")
      return Response.json({ ok: !result.isError, text, notes, ms: performance.now() - started })
    } catch (error) {
      return Response.json({ ok: false, text: streamed + (error instanceof Error ? error.message : String(error)), ms: performance.now() - started })
    }
  },
}
