import { OwnerDO } from "../src/owner/owner-do"
import { ownerName } from "../src/lib/names"
export class ReminderOwner extends OwnerDO {
  async routineTriggers(roomId: string) { return JSON.parse(this.room(roomId).log.meta("routines") ?? "[]") }
  async messages(roomId: string) { return this.room(roomId).log.snapshot().messages }
}
type Env = { OWNER: DurableObjectNamespace<ReminderOwner> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user, roomId] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName(user!)))
    if (kind === "triggers") return Response.json(await stub.routineTriggers(roomId!))
    if (kind === "room") return Response.json(await stub.messages(roomId!))
    const { method, args } = await request.json<{ method: Parameters<ReminderOwner["userCall"]>[0]; args: Parameters<ReminderOwner["userCall"]>[1] }>()
    return Response.json({ result: await stub.userCall(method, args) ?? null })
  },
}
