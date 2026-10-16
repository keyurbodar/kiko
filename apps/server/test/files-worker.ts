import { DurableObject } from "cloudflare:workers"
import { downloadRoute } from "../src/files/download"
import { uploadRoute } from "../src/files/upload"
import type { Env } from "../src/index"
import { RoomFs, roomBackend } from "../src/files/room-fs"
import { ROOM_ID_HEADER, roomStub, USER_ID_HEADER } from "../src/lib/names"

export { FileDO } from "../src/files/file-do"
export { RoomDO } from "../src/room/room-do"

export class UserDO extends DurableObject {
	async recordRoom() {
		return true
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
			const home = { userId: user!, roomId: roomId as never, slug: "ada" as never, role: "", lead: true }
			const fs = new RoomFs("agent", roomBackend(env, () => home))
			const wrote = await fs.write("notes/a.md", new TextEncoder().encode("from the agent"), "text/markdown")
			const read = await fs.readTextFile("notes/a.md")
			return Response.json({ wrote: wrote.ok, read: read.ok ? read.value : null })
		}
		if (kind === "sweep") return Response.json(await roomStub(env.ROOM, user!, roomId!).sweepPending(Number(url.searchParams.get("at"))))
		if (kind === "ws") {
			const headers = new Headers(request.headers)
			headers.set(USER_ID_HEADER, user!)
			headers.set(ROOM_ID_HEADER, roomId!)
			return roomStub(env.ROOM, user!, roomId!).fetch(new Request(request, { headers }))
		}
		return (
			(await uploadRoute(request, env, lookup as never)) ??
			(await downloadRoute(request, env, lookup as never)) ??
			new Response("not found", { status: 404 })
		)
	},
}
