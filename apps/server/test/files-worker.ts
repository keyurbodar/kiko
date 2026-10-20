import { downloadRoute } from "../src/files/download"
import { uploadRoute } from "../src/files/upload"
import type { Env } from "../src/index"
import { RoomFs, roomBackend } from "../src/files/room-fs"
import { ownerName } from "../src/lib/names"
import { OwnerDO as Owner } from "../src/owner/owner-do"

export class OwnerDO extends Owner {
  async agentFiles(userId: string, roomId: string) {
    const home = { userId, roomId: roomId as never, slug: "ada" as never, role: "", lead: true }
    const fs = new RoomFs("agent", roomBackend(this.services, () => home))
    const wrote = await fs.write("notes/a.md", new TextEncoder().encode("from the agent"), "text/markdown")
    const read = await fs.readTextFile("notes/a.md")
    return { wrote: wrote.ok, read: read.ok ? read.value : null }
  }
}

const lookup = async (request: Request) => {
	const id = request.headers.get("x-test-user")
	return id ? { id } : null
}

export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url)
		if (url.pathname === "/keys") {
			const page = await env.FILES!.list()
			return Response.json(page.objects.map((o) => o.key))
		}
		const [, kind, user, roomId] = url.pathname.split("/")
		if (kind === "agent") {
      const stub = env.OWNER.get(env.OWNER.idFromName(ownerName(user!))) as DurableObjectStub<OwnerDO>
      return Response.json(await stub.agentFiles(user!, roomId!))
    }
		return (
			(await uploadRoute(request, env, lookup as never)) ??
			(await downloadRoute(request, env, lookup as never)) ??
			new Response("not found", { status: 404 })
		)
	},
}
