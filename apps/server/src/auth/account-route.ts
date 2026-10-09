import { isAgentSlug, isRoomId, type RoomId } from "@yuki/protocol"
import type { Env } from "../index"
import { agentStub, NameError, roomStub, userStub } from "../lib/names"
import { originAllowed } from "../router"
import { deletionTargets, enqueueDeletion, runDeleteJob, userPrefix } from "../jobs/delete-account"
import { createAuth, isDeletedUser, revokeUser } from "./auth"

// Account deletion. Architecture section 7.9.
//
//   POST /api/account/delete  { confirm: "delete my account" } -> 202 { rooms }
//
// The session must be recent and the body must carry the phrase the client asked the
// person to type. The route records the rooms in `UserDO`, enqueues the jobs, then signs
// the person out everywhere. The jobs in jobs/delete-account.ts do the rest.
//
// Development builds also answer three routes the verify suite uses. They are dead code
// in a production bundle, and they refuse any host but localhost.
//
//   POST /api/dev/account/seed-agent      { roomId, slug }  stores agent data for the session's user
//   GET  /api/dev/account/<userId>/residue?rooms=<id,...>&agents=<roomId:slug,...>
//   POST /api/dev/account/<userId>/rerun  { roomId | null }  runs one job inline and returns its report

declare const process: { env: { NODE_ENV?: string } }

export const CONFIRM_PHRASE = "delete my account"
/** ASSUMPTION: a session younger than this counts as a recent sign-in. Better Auth's own `freshAge` default is a day. */
export const FRESH_SESSION_MS = 10 * 60 * 1000

const DELETE_PATH = "/api/account/delete"
const DEV_PREFIX = "/api/dev/account/"
const DEV_USER_PATH = /^\/api\/dev\/account\/([A-Za-z0-9_-]{1,64})\/(residue|rerun)$/
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
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

/** True when a session that started at `createdAt` may delete the account at `now`. */
export function isFresh(createdAt: Date | string | number, now = Date.now()): boolean {
	const at = new Date(createdAt).getTime()
	return Number.isFinite(at) && now - at < FRESH_SESSION_MS && at <= now + 60_000
}

/** Answers the account routes. Returns null for every other path. */
export async function accountRoute(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url)
	if (url.pathname === DELETE_PATH) return deleteAccount(request, env, url)
	if (process.env.NODE_ENV === "development" && url.pathname.startsWith(DEV_PREFIX)) {
		if (!LOCAL_HOSTS.has(url.hostname)) return error(404, "not found")
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

	// Close the door first. The tombstone and the revoked sessions stop every route and
	// socket, including a cookie the cache still trusts, before any data is touched. The
	// user and account rows stay until the last job, so a retry can still find them.
	const userId = session.user.id
	await revokeUser(env.AUTH_DB, userId)
	const rooms = await userStub(env.USER, userId).beginDeletion()
	await enqueueDeletion(env.JOBS, userId, rooms)

	// Signing out now only clears the cookies. The session row is already gone.
	const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true })
	const response = Response.json({ rooms: rooms.length }, { status: 202 })
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
		if (!match) return error(404, "not found")
		const userId = match[1]!
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

/**
 * What is left of a user. Reading an object wakes it, and a woken object recreates its
 * empty tables, so an object that holds no data is wiped again after the read.
 */
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
	const auth = { user: await count("user", "id"), session: await count("session", "userId"), account: await count("account", "userId") }
	return { user, rooms, agents, objects, auth }
}
