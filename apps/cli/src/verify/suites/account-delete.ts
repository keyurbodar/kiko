import type { RoomId } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P9-02, architecture section 7.9. A fresh user gets two chats, a room that was written
// to but never became a chat, files, an agent with stored data, and a provider key.
// Deleting the account must leave nothing: no room, agent, or user storage, no R2
// object, no D1 row. The old cookie, which Better Auth's cookie cache would still trust,
// gets 401 on `/api/me` and on every socket, sockets opened before deletion are closed,
// and knocking with it wakes no storage. Then the same jobs run a second time and
// report that they had nothing to do.
//
// The residue and rerun checks use development-only routes in auth/account-route.ts.

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
	auth: { user: number; session: number; account: number }
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
			let json: any = null
			try {
				json = text ? JSON.parse(text) : null
			} catch {
				json = text
			}
			return { status: res.status, body: json, headers: res.headers }
		}

		/** Opens a socket of its own, so the suite can see the server close it. */
		function watch(cookie: string, path: string) {
			const url = new URL(path, base)
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
			const ws = new WebSocket(url, { headers: { cookie } } as never)
			let closed = false
			const opened = new Promise<void>((resolve, reject) => {
				ws.onopen = () => resolve()
				ws.onerror = () => reject(new VerifyError(`cannot open ${path}`))
			})
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
		/** The status of a socket upgrade. The router checks the session before it upgrades. */
		async function upgradeStatus(cookie: string, path: string) {
			const headers = { cookie, upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": btoa("kiko-verify-key!") }
			const res = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(10_000) })
			await res.body?.cancel()
			return res.status
		}

		const s = await v.as(`del-${crypto.randomUUID().slice(0, 8)}`)
		// The third room is opened and written to, but never created as a chat.
		const rooms = [ulid(), ulid(), ulid()] as const
		const agent = `${rooms[0]}:ada`

		// Build an account with something in every place deletion must reach.
		const user = await s.user()
		// A device with nothing gets the snapshot first.
		await user.expect({ t: "reset" })
		for (const [i, roomId] of rooms.slice(0, 2).entries()) {
			user.send({ t: "chat", op: { op: "create", roomId, title: `room ${i}` } })
			await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
			const room = await s.room(roomId)
			await room.expect({ t: "events" })
			room.send(`hello ${i}`)
			const put = await call(s.cookie, "PUT", `api/files/${roomId}?path=notes%2F${i}.txt`, undefined, `file ${i}`)
			expectEqual(put.status, 200, `upload ${i} status`)
		}
		const stray = await s.room(rooms[2])
		await stray.expect({ t: "events" })
		stray.send("never a chat")
		await stray.expect((f) => f.t === "events" && f.events.some((e) => e.t === "message"))
		expectEqual((await call(s.cookie, "POST", "api/dev/account/seed-agent", { roomId: rooms[0], slug: "ada" })).status, 200, "seed status")
		const key = await call(s.cookie, "PUT", "api/credentials/opencode-go", { apiKey: `sk-verify-${crypto.randomUUID()}` })
		expectEqual(key.status, 200, "credential status")

		const residuePath = `api/dev/account/${s.userId}/residue?rooms=${rooms.join(",")}&agents=${agent}`
		const residue = async () => (await call(null, "GET", residuePath)).body as Residue
		const before = await residue()
		if (!(before.user > 0 && Object.values(before.rooms).every((n) => n > 0) && before.agents[agent]! > 0)) {
			throw new VerifyError(`the account was not built\n${JSON.stringify(before)}`)
		}
		expectEqual([before.objects, before.auth.user], [2, 1], "objects and the user row before deletion")

		// The confirmation phrase is required.
		const wrong = await call(s.cookie, "POST", "api/account/delete", { confirm: "yes" })
		expectEqual(wrong.status, 400, "status without the typed confirmation")

		// Sockets opened before deletion. The server must close them.
		const sockets = [watch(s.cookie, "api/ws/user"), watch(s.cookie, `api/ws/room/${rooms[2]}`)]
		for (const w of sockets) await w.opened
		expectEqual((await call(s.cookie, "GET", "api/me")).status, 200, "/api/me before deletion")

		const deleted = await call(s.cookie, "POST", "api/account/delete", { confirm: CONFIRM })
		// Three rooms of this suite, plus the kiko chat every account gets when it signs in.
		expectEqual([deleted.status, deleted.body], [202, { rooms: 4 }], "the delete answer, the room that is no chat and the kiko chat included")
		if (!deleted.headers.getSetCookie().some((c) => /max-age=0/i.test(c))) throw new VerifyError("the delete answer did not clear the cookie")

		// The old cookie still carries Better Auth's five-minute cache. It must not sign in.
		const shut = async (when: string) => {
			expectEqual((await call(s.cookie, "GET", "api/me")).status, 401, `/api/me with the old cookie ${when}`)
			expectEqual(await upgradeStatus(s.cookie, "api/ws/user"), 401, `the user socket with the old cookie ${when}`)
			expectEqual(await upgradeStatus(s.cookie, `api/ws/room/${rooms[0]}`), 401, `a room socket with the old cookie ${when}`)
			expectEqual(await upgradeStatus(s.cookie, `api/ws/room/${ulid()}`), 401, `a new room socket with the old cookie ${when}`)
		}
		await shut("right after deletion")

		// The queue runs the jobs. Wait for every place to be empty.
		const gone: Residue = {
			user: 0,
			rooms: Object.fromEntries(rooms.map((r) => [r, 0])),
			agents: { [agent]: 0 },
			objects: 0,
			auth: { user: 0, session: 0, account: 0 },
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

		// Knocking with the old cookie after the D1 rows are gone wakes nothing.
		await shut("after the jobs finished")
		expectEqual(await residue(), gone, "what is left after the old cookie knocked")

		// A second run of the same jobs succeeds and has nothing to do.
		const nothing = { agents: 0, rooms: 0, user: 0, objects: 0, authRows: 0, finished: true }
		for (const roomId of [...rooms, null]) {
			const again = await call(null, "POST", `api/dev/account/${s.userId}/rerun`, { roomId })
			expectEqual([again.status, again.body], [200, { report: nothing }], `the second run for ${roomId ?? "the user"}`)
		}
		expectEqual(await residue(), gone, "what is left after the second run")

		// The kiko chat's agent may still be answering "hello 0" when its storage is deleted. A harness left
		// running on deleted tables used to keep the server so busy that it answered nothing more.
		await new Promise((r) => setTimeout(r, 2_000))
		const health = await fetch(new URL("api/health", base), { signal: AbortSignal.timeout(5_000) }).then((r) => r.status, () => 0)
		expectEqual(health, 200, "the server's health after the deletion")
	},
}

export default suite
