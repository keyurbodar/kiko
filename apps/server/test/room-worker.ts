import type { AgentSlug } from "@kiko/protocol"
import { OwnerDO } from "../src/owner/owner-do"
import { ownerName } from "../src/lib/names"

export class OwnerProbe extends OwnerDO {
  async typingProbe(roomId: string, slug: AgentSlug, on: boolean): Promise<void> {
    const room = this.room(roomId)
    room.memberOp({ op: "add", slug, name: slug })
    await room.setStatus(slug, on ? "typing" : "idle")
  }

  async storedRows(roomId: string): Promise<number> {
    const sql = this.ctx.storage.sql
    const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()
    let rows = 0
    for (const { name } of tables) {
      if (name.startsWith("sqlite_") || name.startsWith("_cf_") || name.includes("_fts")) continue
      const quoted = `"${name.replaceAll('"', '""')}"`
      const scoped = sql.exec<{ name: string }>(`PRAGMA table_info(${quoted})`).toArray().some((column) => column.name === "room_id")
      rows += sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${quoted}${scoped ? " WHERE room_id = ?" : ""}`, ...(scoped ? [roomId] : [])).one().n
    }
    return rows
  }
}

type Env = { OWNER: DurableObjectNamespace<OwnerProbe> }

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, slug, on] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName("alice")))
    if (kind === "post") {
      const { runId, block } = await request.json<{ runId: string; block: string }>()
      return Response.json(await stub.roomCall(roomId!, "post", [slug as AgentSlug, runId, 0, 0, block]))
    }
    if (kind === "rows") return Response.json(await stub.storedRows(roomId!))
    if (kind === "typing") {
      await stub.typingProbe(roomId!, slug as AgentSlug, on === "1")
      return new Response("ok")
    }
    return stub.fetch(request)
  },
}
