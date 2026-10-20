import { MeteredOwner } from "./owner-meter"
import { ownerName } from "../src/lib/names"
import type { RoomId } from "@kiko/protocol"
import type { Life } from "@kiko/memory/life"

type SeedKind = "life" | "chats" | "reminders" | "boards" | "capture"
const roomAt = (index: number) => `01J00000000000000000000000`.slice(0, 18) + String(index).padStart(8, "0")
export class UserMeter extends MeteredOwner {
  async measure(op: string, args: unknown[]) {
    const before = this.counts()
    if (op === "lifeNearest") (this.user() as unknown as { life: Life }).life.nearest(String(args[0]), 12)
    else if (op === "openTasks") this.room(String(args[0])).openTasks()
    else await this.userCall(op as Parameters<MeteredOwner["userCall"]>[0], args as Parameters<MeteredOwner["userCall"]>[1])
    const after = this.counts()
    return { read: after.read - before.read, written: after.written - before.written }
  }
  async seed(kind: SeedKind, count: number): Promise<number> {
    const sql = this.ctx.storage.sql
    const now = Date.now()
    if (kind === "chats") {
      for (let index = 1; index <= count; index++) await this.user().createChat(roomAt(index) as RoomId, `chat ${index}`)
      return count
    }
    if (kind === "boards") {
      for (let index = 1; index <= count; index++) sql.exec("INSERT INTO ws_tasks (room_id,id,title,status,created_by,created_seq,updated_at) VALUES (?, 'task', 'task', 'todo', 'human', 1, ?)", roomAt(index), now - 86_400_000)
      return count
    }
    this.ctx.storage.transactionSync(() => {
      for (let index = 1; index <= count; index++) {
        if (kind === "life") {
          sql.exec("INSERT INTO life (pos,at,text,source,norm,card) VALUES (?,?,?,'ada',?,?)", index, now, `tok${index}`, `tok${index}`, index % 50 === 0 ? "ATTRIBUTE" : null)
          sql.exec("INSERT INTO life_fts (rowid,text) VALUES (?,?)", index, `tok${index}`)
          sql.exec("INSERT INTO life_tri (rowid,text) VALUES (?,?)", index, `tok${index}`)
        } else if (kind === "reminders") sql.exec("INSERT INTO reminders (id,text,due_utc,tz,rrule,room_id,target,created_by,status,last_fired,created_at) VALUES (?, ?, ?, 'UTC', NULL, ?, 'human', 'human', 'done', ?, ?)", `done${index}`, `old ${index}`, now - 86_400_000, roomAt(1), now - 86_400_000, now - 86_400_000)
        else sql.exec("INSERT INTO capture_queue (room_id,message_id,text,at,queued_at) VALUES (?, ?, 'queued line', ?, ?)", roomAt(1), `q${index}`, now, now)
      }
    })
    return count
  }
}
type Env = { OWNER: DurableObjectNamespace<UserMeter> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName(user!)))
    if (kind === "seed") { const { what, n } = await request.json<{ what: SeedKind; n: number }>(); return Response.json(await stub.seed(what, n)) }
    const { op, args } = await request.json<{ op: string; args: unknown[] }>()
    return Response.json(await stub.measure(op, args))
  },
}
