import type { RoomId } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const CONFIRM = "delete my account"

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function ulid(): RoomId {
	let time = Date.now()
	let head = ""
	for (let i = 0; i < 10; i++) {
		head = CROCKFORD[time % 32] + head
		time = Math.floor(time / 32)
	}
	return (head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")) as RoomId
}

type Residue = {
	user: number
	rooms: Record<string, number>
	agents: Record<string, number>
	objects: number
	auth: { user: number; session: number; account: number; hooks: number }
}

const suite: Suite = {
	name: "account-delete",
	async run(v) {
		const base = v.url.endsWith("/") ? v.url : `${v.url}/`
		async function call(cookie: string | null, method: string, path: string, body?: unknown, raw?: BodyInit) {
			const headers: Record<string, string> = {}
			if (cookie) headers.cookie = cookie
			if (body !== undefined) headers["content-type"] = "application/json"
			const res = await fetch(new URL(path, base), {
				method,
				headers,
				body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
				signal: AbortSignal.timeout(10_000),
			})
			const text = await res.text()
			let json: unknown = null
			try {
				json = text ? JSON.parse(text) : null
			} catch {
				json = text
			}
			return { status: res.status, body: json, headers: res.headers }
		}

		function watch(cookie: string, path: string) {
			const url = new URL(path, base)
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
			const ws = new WebSocket(url, { headers: { cookie } } as never)
			let closed = false
			const { promise: opened, resolve, reject } = Promise.withResolvers<void>()
			ws.onopen = () => resolve()
			ws.onerror = () => reject(new VerifyError(`cannot open ${path}`))
			ws.onclose = () => {
				closed = true
			}
			return { opened, isClosed: () => closed, close: () => ws.close() }
		}
		async function until(test: () => boolean, ms: number) {
			const deadline = Date.now() + ms
			while (!test() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
			return test()
		}
		async function upgradeStatus(cookie: string, path: string) {
			const headers = { cookie, upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": btoa("yuki-verify-key!") }
			const res = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(10_000) })
			await res.body?.cancel()
			return res.status
		}

		const s = await v.as(`del-${crypto.randomUUID().slice(0, 8)}`)
		const rooms = [ulid(), ulid(), ulid()] as const
		const agent = `${rooms[0]}:ada`

		const user = await s.user()
		await user.expect({ t: "reset" })
		for (const [i, roomId] of rooms.slice(0, 2).entries()) {
			user.send({ t: "chat", op: { op: "create", roomId, title: `room ${i}` } })
			await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
			const room = await s.room(roomId)
			await room.expect({ t: "events" })
			room.send(`hello ${i}`)
			const put = await s.putFile(roomId, `notes/${i}.txt`, `file ${i}`)
			expectEqual(put.status, 200, `upload ${i} status`)
		}
		const stray = await s.room(rooms[2])
		await stray.expect({ t: "events" })
		stray.send("never a chat")
		await stray.expect((f) => f.t === "events" && f.events.some((e) => e.t === "message"))
		expectEqual((await call(s.cookie, "POST", "api/dev/account/seed-agent", { roomId: rooms[0], slug: "ada" })).status, 200, "seed status")
		const key = await call(s.cookie, "PUT", "api/credentials/opencode-go", { apiKey: `sk-verify-${crypto.randomUUID()}` })
		expectEqual(key.status, 200, "credential status")

		// Another live user with one file. The dev routes name the session's user, so a path that names this user reaches nothing.
		const other = await v.as(`del-other-${crypto.randomUUID().slice(0, 8)}`)
		const otherRoom = ulid()
		const otherUser = await other.user()
		await otherUser.expect({ t: "reset" })
		otherUser.send({ t: "chat", op: { op: "create", roomId: otherRoom, title: "other" } })
		await otherUser.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === otherRoom))
		expectEqual((await other.putFile(otherRoom, "notes/other.txt", "the other user's file")).status, 200, "the other user's upload status")
		const otherResidue = `api/dev/account/${other.userId}/residue`

		const residuePath = `api/dev/account/${s.userId}/residue?rooms=${rooms.join(",")}&agents=${agent}`
		const residue = async (cookie: string | null = null) => (await call(cookie, "GET", residuePath)).body as Residue
		const before = await residue(s.cookie)
		if (!(before.user > 0 && Object.values(before.rooms).every((n) => n > 0) && (before.agents[agent] ?? 0) > 0)) {
			throw new VerifyError(`the account was not built\n${JSON.stringify(before)}`)
		}
		expectEqual(before.auth.user, 1, "the user row before deletion")
		// Two objects, the two uploads. No chat.md: a room seeds one only with two members, and these rooms hold just the chief. Exact, so a leaked object fails here.
		expectEqual(before.objects, 2, "the objects in the account: the two uploads")

		// The session's rooms named on the other user's path: only the session's own objects answer.
		const otherBefore = (await call(other.cookie, "GET", otherResidue)).body as Residue
		const crossed = await call(s.cookie, "GET", `${otherResidue}?rooms=${rooms[0]}&agents=${agent}`)
		expectEqual(crossed.status, 200, "a live session's residue for another user's path")
		const own = crossed.body as Residue
		expectEqual([own.rooms[rooms[0]], own.agents[agent]], [before.rooms[rooms[0]], before.agents[agent]], "the session's own room and agent, not the other user's")
		const crossedRerun = await call(s.cookie, "POST", `api/dev/account/${other.userId}/rerun`, { roomId: null })
		expectEqual([crossedRerun.status, (crossedRerun.body as { report: { finished: boolean } }).report.finished], [200, false], "a live session's rerun for another user's path")
		expectEqual(((await call(other.cookie, "GET", otherResidue)).body as Residue).objects, otherBefore.objects, "the other user's objects after the crossed rerun")
		expectEqual((await call(null, "GET", otherResidue)).status, 403, "a live user's residue without a session")

		const wrong = await call(s.cookie, "POST", "api/account/delete", { confirm: "yes" })
		expectEqual(wrong.status, 400, "status without the typed confirmation")

		const sockets = [watch(s.cookie, "api/ws/user"), watch(s.cookie, `api/ws/room/${rooms[2]}`)]
		for (const w of sockets) await w.opened
		expectEqual((await call(s.cookie, "GET", "api/me")).status, 200, "/api/me before deletion")

		const deleted = await call(s.cookie, "POST", "api/account/delete", { confirm: CONFIRM })
		expectEqual([deleted.status, deleted.body], [202, { rooms: 4 }], "the delete answer, the room that is no chat and the yuki chat included")
		if (!deleted.headers.getSetCookie().some((c) => /max-age=0/i.test(c))) throw new VerifyError("the delete answer did not clear the cookie")

		const shut = async (when: string) => {
			expectEqual((await call(s.cookie, "GET", "api/me")).status, 401, `/api/me with the old cookie ${when}`)
			expectEqual(await upgradeStatus(s.cookie, "api/ws/user"), 401, `the user socket with the old cookie ${when}`)
			expectEqual(await upgradeStatus(s.cookie, `api/ws/room/${rooms[0]}`), 401, `a room socket with the old cookie ${when}`)
			expectEqual(await upgradeStatus(s.cookie, `api/ws/room/${ulid()}`), 401, `a new room socket with the old cookie ${when}`)
		}
		await shut("right after deletion")

		const gone: Residue = {
			user: 0,
			rooms: Object.fromEntries(rooms.map((r) => [r, 0])),
			agents: { [agent]: 0 },
			objects: 0,
			auth: { user: 0, session: 0, account: 0, hooks: 0 },
		}
		const deadline = Date.now() + 30_000
		let after = await residue()
		while (JSON.stringify(after) !== JSON.stringify(gone) && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 500))
			after = await residue()
		}
		expectEqual(after, gone, "what is left after deletion")
		if (!(await until(() => sockets.every((w) => w.isClosed()), 5000))) {
			throw new VerifyError(`sockets opened before deletion are still open: ${sockets.map((w) => w.isClosed())}`)
		}

		await shut("after the jobs finished")
		expectEqual(await residue(), gone, "what is left after the old cookie knocked")

		const nothing = { agents: 0, rooms: 0, user: 0, objects: 0, authRows: 0, finished: true }
		for (const roomId of [...rooms, null]) {
			const again = await call(null, "POST", `api/dev/account/${s.userId}/rerun`, { roomId })
			expectEqual([again.status, again.body], [200, { report: nothing }], `the second run for ${roomId ?? "the user"}`)
		}
		expectEqual(await residue(), gone, "what is left after the second run")

		await new Promise((r) => setTimeout(r, 2_000))
		const health = await fetch(new URL("api/health", base), { signal: AbortSignal.timeout(5_000) }).then((r) => r.status, () => 0)
		expectEqual(health, 200, "the server's health after the deletion")
	},
}

export default suite
