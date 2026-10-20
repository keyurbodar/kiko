import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ToolExecutionApi } from "@earendil-works/pi-durable"
import type { FileOp } from "@kiko/protocol"
import "@kiko/agent/effects"
import { filesExtension } from "../src/agent/extensions/files"
import { HOME } from "../src/files/upload"
import { type FilesBackend, homeBackend, RoomFs, roomBackend, withMount, withSoul } from "../src/files/room-fs"
import { kikoDocsBackend, KIKO } from "../src/files/kiko-docs"
import type { Env } from "../src/index"
import { ownerName } from "../src/lib/names"
import { OwnerDO as BaseOwner } from "../src/owner/owner-do"
import type { OwnerServices } from "../src/owner/services"

const notices: string[] = []

const systems = new Map<string, RoomFs>()
const counts = new Map<string, { stat: number; get: number; put: number }>()
// Per request: a hook that runs when a commit starts, and a path substring whose writes the drive refuses.
let beforeCommit: (() => void) | null = null
let refusing: string | null = null

function counted(key: string, backend: FilesBackend, env: Env & { FILES: R2Bucket }): FilesBackend {
  const c = { stat: 0, get: 0, put: 0 }
  counts.set(key, c)
  return {
    ...backend,
    stat: (p) => (c.stat++, backend.stat(p)),
    bytes: async (k, m) => {
      const before = (env.FILES as unknown as { _gets?: number })._gets ?? 0
      const out = await backend.bytes(k, m)
      return (c.get += ((env.FILES as unknown as { _gets?: number })._gets ?? 0) - before), out
    },
    write: (...a) => (c.put++, refusing && a[0].includes(refusing) ? { ok: false as const, code: "invalid" as const, message: "refused in test" } : backend.write(...a)),
    commit: (changes) => (beforeCommit?.(), backend.commit(changes)),
  }
}

async function handle(request: Request, env: Env & { FILES: R2Bucket }, services: OwnerServices) {
    const [, kind, roomId, slug] = new URL(request.url).pathname.split("/")
    if (kind === "keys") {
      const page = await env.FILES.list({ prefix: "" })
      return Response.json(page.objects.map((o) => o.key).filter((k) => k.includes(roomId!)))
    }
    if (kind === "raw") {
      const url = new URL(request.url)
      const home = { userId: "alice", roomId: roomId as never, slug: "human" as never, role: "", lead: true }
      const fs = new RoomFs("raw", roomBackend(services, () => home))
      const out = await fs.write(url.searchParams.get("path")!, new Uint8Array(await request.arrayBuffer()), url.searchParams.get("type")!)
      return Response.json({ ok: out.ok })
    }
    if (kind === "idle") {
      await services.room(roomId!).setStatus(slug as never, "idle")
      return Response.json({ ok: true })
    }
    if (kind === "notices") return Response.json(notices.splice(0))
    if (kind === "counts") {
      const c = counts.get(`${roomId}/${slug}`)!
      const out = { ...c }
      c.stat = c.get = c.put = 0
      return Response.json(out)
    }
    if (kind === "op") return Response.json({ refused: await services.room(roomId!).fileOp((await request.json()) as FileOp) })
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
      const user = () => services.user()
      const soul = { get: () => user().soul(slug!), set: (body: string, expect: string) => user().setSoul(slug!, body, expect) }
      const drive = homeBackend(services, () => home, async (text) => void notices.push(`@${slug} ${text}`), undefined, () => (slug === "quiet" ? "this chat is private" : null))
      fs = new RoomFs(`test:${key}`, withSoul(withMount(withMount(counted(key, roomBackend(services, () => home), env), HOME, drive), KIKO, kikoDocsBackend()), soul))
      systems.set(key, fs)
    }
    const { name, args } = (await request.json()) as { name: string; args: Record<string, unknown> }
    // The stop header stops the call the moment its commit starts; the commit still runs to its end, as in a real stop during a save.
    const stop = new AbortController()
    const touched: string[] = []
    beforeCommit = request.headers.get("x-test-stop-on-commit") ? () => stop.abort() : null
    refusing = request.headers.get("x-test-refuse")
    const tool = (filesExtension({ fs, acceptsImages: () => slug === "seer", touched: (_, paths) => void touched.push(...paths) }).tools ?? []).find((t) => t.name === name)
    if (!tool) return Response.json({ error: `no tool ${name}` }, { status: 404 })
    let streamed = ""
    let reported: unknown
    const api = { env: fs, agent: async () => ({ model: { provider: "faux", modelId: "faux-1" } }), conversationId: "c1", callId: crypto.randomUUID(), output: (t: string) => void (streamed += t), retainedOutput: () => ({ text: streamed, truncated: false }), diagnostic: () => {}, details: async (d: unknown) => void (reported = d) } as unknown as ToolExecutionApi
    const started = performance.now()
    try {
      const result = await tool.execute(args as never, api, { ...BACKGROUND_CONTEXT, abortSignal: stop.signal })
      const text = (result.output ?? []).map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("") || streamed
      const notes = (result.diagnostics ?? []).map((d) => d.message).join("\n")
      return Response.json({ ok: !result.isError, text, notes, ms: performance.now() - started, details: reported ?? result.details, touched })
    } catch (error) {
      return Response.json({ ok: false, text: streamed + (error instanceof Error ? error.message : String(error)), ms: performance.now() - started, details: reported, touched })
    } finally {
      beforeCommit = null
      refusing = null
    }
}

export class FilesOwner extends BaseOwner {
  override fetch(request: Request): Promise<Response> {
    return handle(request, { ...this.env, FILES: this.env.FILES! }, this.services)
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.OWNER.get(env.OWNER.idFromName(ownerName("alice"))).fetch(request)
  },
}
