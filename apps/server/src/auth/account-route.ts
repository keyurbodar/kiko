import { isAgentSlug, isRoomId, type RoomId } from "@yuki/protocol"
import type { Env } from "../index"
import { agentStub, NameError, roomStub, userStub } from "../lib/names"
import { originAllowed } from "../router"
import { deletionTargets, enqueueDeletion, runDeleteJob, startDeletion, userPrefix } from "../jobs/delete-account"
import { createAuth, isDeletedUser, restoreUser, revokeUser } from "./auth"

// Development builds answer the verify-suite routes below. They are dead code in a production bundle.
declare const process: { env: { NODE_ENV?: string } }

export const CONFIRM_PHRASE = "delete my account"
// Better Auth's own freshAge default is a day; this shorter window is deliberate.
export const FRESH_SESSION_MS = 10 * 60 * 1000

const DELETE_PATH = "/api/account/delete"
const DEV_PREFIX = "/api/dev/account/"
const DEV_USER_PATH = /^\/api\/dev\/account\/([A-Za-z0-9_-]{1,64})\/(residue|rerun)$/
const LOCAL_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true }
const MAX_BODY = 4096

function error(status: number, message: string): Response {
	return Response.json({ error: message }, { status })
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
	if (!request.headers.get("content-type")?.includes("json")) return null
	const text = await request.text()
	if (text.length > MAX_BODY) return null
	try {
		const body: unknown = JSON.parse(text)
		return body && typeof body === "object" ? (body as Record<string, unknown>) : null
	} catch {
		return null
	}
}

export function isFresh(createdAt: Date | string | number, now = Date.now()): boolean {
	const at = new Date(createdAt).getTime()
	return Number.isFinite(at) && now - at < FRESH_SESSION_MS && at <= now + 60_000
}

export async function accountRoute(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url)
	if (url.pathname === DELETE_PATH) return deleteAccount(request, env, url)
	if (process.env.NODE_ENV === "development" && url.pathname.startsWith(DEV_PREFIX)) {
		if (LOCAL_HOSTS[url.hostname] !== true) return error(404, "not found")
		return devRoute(request, env, url)
	}
	return null
}

async function deleteAccount(request: Request, env: Env, url: URL): Promise<Response> {
	if (request.method !== "POST") return error(405, "method not allowed")
	if (!originAllowed(request, url, env)) return error(403, "forbidden origin")
	const auth = createAuth(env, request)
	const session = await auth.api.getSession({ headers: request.headers })
	if (!session || (await isDeletedUser(env.AUTH_DB, session.user.id))) return error(401, "unauthorized")
	if (!isFresh(session.session.createdAt)) {
		return Response.json({ error: "sign in again to delete your account", reauth: true }, { status: 403 })
	}
	const body = await readJson(request)
	if (body?.confirm !== CONFIRM_PHRASE) return error(400, `type "${CONFIRM_PHRASE}" to confirm`)

	const userId = session.user.id
	let user: ReturnType<typeof userStub>
	try {
		user = userStub(env.USER, userId)
	} catch (e) {
		if (e instanceof NameError) return error(400, e.message)
		throw e
	}
	let rooms: number
	try {
		rooms = await startDeletion({
			revoke: () => revokeUser(env.AUTH_DB, userId),
			begin: () => user.beginDeletion(),
			enqueue: (ids) => enqueueDeletion(env.JOBS, userId, ids),
			abort: async () => {
				await user.cancelDeletion()
				await restoreUser(env.AUTH_DB, userId)
			},
		})
	} catch (e) {
		console.error("account deletion could not start", e)
		return error(503, "could not start deleting your account, sign in and try again")
	}

	const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true })
	const response = Response.json({ rooms }, { status: 202 })
	for (const cookie of headers.getAll("set-cookie")) response.headers.append("set-cookie", cookie)
	return response
}

async function devRoute(request: Request, env: Env, url: URL): Promise<Response> {
	try {
		if (url.pathname === `${DEV_PREFIX}seed-agent`) {
			if (request.method !== "POST") return error(405, "method not allowed")
			const session = await createAuth(env, request).api.getSession({ headers: request.headers })
			if (!session || (await isDeletedUser(env.AUTH_DB, session.user.id))) return error(401, "unauthorized")
			const body = await readJson(request)
			const roomId = body?.roomId
			const slug = body?.slug
			if (typeof roomId !== "string" || typeof slug !== "string" || !isRoomId(roomId) || !isAgentSlug(slug)) return error(400, "bad room id or slug")
			await roomStub(env.ROOM, session.user.id, roomId).devAgentMessage(slug, "seeded for the deletion check")
			await agentStub(env.AGENT, session.user.id, roomId, slug).devSeed()
			return Response.json({ ok: true })
		}
		const match = DEV_USER_PATH.exec(url.pathname)
		const userId = match?.[1]
		if (!match || userId === undefined) return error(404, "not found")
		if (match[2] === "rerun") {
			if (request.method !== "POST") return error(405, "method not allowed")
			const body = await readJson(request)
			const roomId = body?.roomId ?? null
			if (roomId !== null && (typeof roomId !== "string" || !isRoomId(roomId))) return error(400, "bad room id")
			const report = await runDeleteJob({ kind: "delete-account", userId, roomId }, deletionTargets(env, userId))
			return Response.json({ report })
		}
		return Response.json(await residue(env, userId, url))
	} catch (e) {
		if (e instanceof NameError) return error(400, e.message)
		throw e
	}
}

// Reading an object wakes it and recreates its empty tables, so an empty object is wiped again after the probe.
async function residue(env: Env, userId: string, url: URL) {
	const list = (key: string) => (url.searchParams.get(key) ?? "").split(",").filter(Boolean)
	const probe = async (stub: { storedRows(): Promise<number>; deleteAll(): Promise<number> }) => {
		const rows = await stub.storedRows()
		if (rows === 0) await stub.deleteAll()
		return rows
	}
	const rooms: Record<string, number> = {}
	for (const roomId of list("rooms")) rooms[roomId] = await probe(roomStub(env.ROOM, userId, roomId as RoomId))
	const agents: Record<string, number> = {}
	for (const pair of list("agents")) {
		const [roomId = "", slug = ""] = pair.split(":")
		agents[pair] = await probe(agentStub(env.AGENT, userId, roomId, slug))
	}
	const user = await probe(userStub(env.USER, userId))
	const objects = (await env.FILES.list({ prefix: userPrefix(userId) })).objects.length
	const count = (table: string, column: string) =>
		env.AUTH_DB.prepare(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ?`).bind(userId).first<number>("n")
	const auth = {
		user: await count("user", "id"),
		session: await count("session", "userId"),
		account: await count("account", "userId"),
		hooks: await count("hooks", "user_id"),
	}
	return { user, rooms, agents, objects, auth }
}
