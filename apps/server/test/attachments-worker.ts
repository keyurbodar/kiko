import { downloadRoute } from "../src/files/download"
import { uploadRoute } from "../src/files/upload"
import type { Env } from "../src/index"
import { ownerStub, USER_ID_HEADER } from "../src/lib/names"

// The real upload and download routes and the real OwnerDO, with the session taken from an
// `x-test-user` header. `/keys` lists every R2 key. `/ws/<user>/<roomId>` opens the owner socket
// as that user: the one socket that reaches both the user and the room. `/sweep/<user>/<roomId>?at=`
// runs the room's pending sweep as of `at`.

export { OwnerDO } from "../src/owner/owner-do"

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
		if (kind === "ws") {
			const headers = new Headers(request.headers)
			headers.set(USER_ID_HEADER, user!)
			url.pathname = "/api/ws"
			return ownerStub(env.OWNER, user!).fetch(new Request(url, { headers }))
		}
		if (kind === "sweep") {
			const at = Number(url.searchParams.get("at"))
			return Response.json(await ownerStub(env.OWNER, user!).roomCall(roomId!, "sweepPending", [at]))
		}
		return (
			(await uploadRoute(request, env, lookup as never)) ??
			(await downloadRoute(request, env, lookup as never)) ??
			new Response("not found", { status: 404 })
		)
	},
}
