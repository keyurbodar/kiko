import { humanAnswerText } from "@kiko/protocol"
// Pending patches over the server state. Architecture section 9.3.
//
// Every user action becomes a patch first. A patch is the frame the action
// sends, plus a local `clientId`. The view is the server state with every
// pending patch laid over it, in order. A patch is dropped when the server
// confirms it: a `send` by its `clientId` (or once the store has applied the
// `seq` its `ack` named), every other action by the first event that shows the
// same change. The tables below are the whole rule.
//
// ASSUMPTION: only `send` has an `ack` frame in the protocol, so the other
// actions are confirmed by the event they cause. One the server never confirms
// (it refused it, or its message was deleted) expires `ttlMs` after it last
// went out on an open socket.
//
// Everything here is pure, so the tests and both stores share it.

import type {
	HumanAsk,
	Chat,
	Member,
	ChatOp,
	ClientToRoom,
	FileRef,
	Message,
	MessageId,
	RoomEvent,
	Task,
	UserEvent,
} from "@kiko/protocol"

/** The room frames that change state. `hello`, `typing`, and `stop` change nothing to show. */
export type RoomPatchFrame = Exclude<ClientToRoom, { t: "hello" } | { t: "typing" } | { t: "stop" } | { t: "search" } | { t: "history" } | { t: "model" }>
export type SendFrame = Extract<ClientToRoom, { t: "send" }>

export type RoomPatch = {
	clientId: string
	ask?: HumanAsk
	frame: RoomPatchFrame
	/** Epoch milliseconds when the user acted. */
	at: number
	/** Epoch milliseconds when it last went out on an open socket. Unset while offline. */
	sentAt?: number
	/** Set by an `ack`. The patch stays until the store has applied `seq`, so the bubble never blinks. */
	ack?: { id: MessageId; seq: number }
	/** A send's attachments from their blob URLs, shown until the room's message names its files. Never in the outbox. */
	local?: readonly LocalAttachment[]
	/** The room refused the send (`send_refused`), and why. It stays on screen and is not sent again. */
	failed?: boolean
	reason?: string
}

/** An attachment drawn from a local blob URL until the room's copy arrives. */
export type LocalAttachment = { src: string; name: string; type: string; size: number }

export type UserPatch = {
	clientId: string
	op: ChatOp
	at: number
	sentAt?: number
}

/** A message as the transcript draws it. A pending send has `pending` and its `clientId`. */
export type ViewMessage = Message & { clientId?: string; pending?: boolean; local?: readonly LocalAttachment[]; failed?: boolean; reason?: string }

/** How long an unconfirmed action may stay after it went out. */
export const PATCH_TTL_MS = 15_000

/** The id an unacknowledged send shows under. */
export const localMessageId = (clientId: string) => `local:${clientId}` as MessageId

// Confirmation, as a table of cases.

type Confirms = {
	[K in RoomPatchFrame["t"]]: (frame: Extract<RoomPatchFrame, { t: K }>, event: RoomEvent, clientId: string) => boolean
}

const roomConfirms: Confirms = {
	send: (_, e, clientId) => e.t === "message" && e.clientId === clientId,
	react: (f, e) => e.t === "react" && e.messageId === f.messageId && e.by.kind === "human" && e.emoji === f.emoji,
	edit: (f, e) => e.t === "edit" && e.messageId === f.messageId && e.text === f.text,
	delete: (f, e) => e.t === "delete" && e.messageIds.includes(f.messageId),
	read: (f, e) => e.t === "read" && e.upTo >= f.seq,
	answer: (f, e) => (e.t === "message" && e.clientId === `answer:${f.id}`) || (e.t === "ask_resolved" && e.id === f.id && e.how === "skipped"),
	skip: (f, e) => e.t === "ask_resolved" && e.id === f.id,
	task: (f, e) =>
		f.op.op === "delete" ? e.t === "task_removed" && e.id === f.op.id : e.t === "task" && e.task.id === f.op.id,
	member: (f, e) =>
		f.op.op === "remove" ? e.t === "member_removed" && e.slug === f.op.slug : e.t === "member" && e.member.slug === f.op.slug,
	// ASSUMPTION: the events carry ids, not the paths the frame named, so any removal confirms an rm
	// and a file landing under the target confirms an mv. A refusal drops the patch at once.
	files: (f, e) => {
		const op = f.op
		if (op.op === "mkdir") return e.t === "folders" && e.folders.includes(op.path)
		if (op.op === "rm") return e.t === "file_removed" || (e.t === "folders" && !op.paths.some((p) => e.folders.includes(p)))
		return (e.t === "file" && (e.file.name === op.to || e.file.name.startsWith(`${op.to}/`))) || (e.t === "folders" && e.folders.some((p) => p === op.to || p.startsWith(`${op.to}/`)))
	},
}

export function roomConfirmedBy(patch: RoomPatch, event: RoomEvent): boolean {
	const check = roomConfirms[patch.frame.t] as ((f: RoomPatchFrame, e: RoomEvent, c: string) => boolean) | undefined
	// A frame kind the protocol no longer has (an old approve in the outbox) settles at once.
	return check ? check(patch.frame, event, patch.clientId) : true
}

/** The patches still pending after `events` and with the store at `appliedSeq`. */
export function settleRoom(patches: readonly RoomPatch[], events: readonly RoomEvent[], appliedSeq: number): RoomPatch[] {
	return patches.filter(
		(p) => !(p.ack && p.ack.seq <= appliedSeq) && !events.some((e) => roomConfirmedBy(p, e)),
	)
}

type UserConfirms = { [K in ChatOp["op"]]: (op: Extract<ChatOp, { op: K }>, event: UserEvent) => boolean }

const userConfirms: UserConfirms = {
	create: (op, e) => e.t === "chat" && e.chat.roomId === op.roomId,
	rename: (op, e) => e.t === "chat" && e.chat.roomId === op.roomId && e.chat.title === op.title,
	pin: (op, e) => e.t === "chat" && e.chat.roomId === op.roomId && e.chat.pinned === op.pinned,
	mute: (op, e) => e.t === "chat" && e.chat.roomId === op.roomId && e.chat.muted === op.muted,
	private: (op, e) => e.t === "chat" && e.chat.roomId === op.roomId && (e.chat.private ?? false) === op.private,
	delete: (op, e) => e.t === "chat_removed" && e.roomId === op.roomId,
}

export function userConfirmedBy(patch: UserPatch, event: UserEvent): boolean {
	const check = userConfirms[patch.op.op] as (op: ChatOp, e: UserEvent) => boolean
	return check(patch.op, event)
}

export function settleUser(patches: readonly UserPatch[], events: readonly UserEvent[]): UserPatch[] {
	return patches.filter((p) => !events.some((e) => userConfirmedBy(p, e)))
}

/** Drops patches that went out more than `ttlMs` ago and were never confirmed. Sends never expire. */
export function expire<P extends { sentAt?: number; frame?: RoomPatchFrame }>(
	patches: readonly P[],
	now: number,
	ttlMs = PATCH_TTL_MS,
): P[] {
	return patches.filter((p) => p.frame?.t === "send" || p.sentAt === undefined || now - p.sentAt < ttlMs)
}

// The overlays. Each returns the server object itself when no patch touches it,
// so a keyed list keeps every untouched row.

function pendingMessage(p: RoomPatch & { frame: SendFrame }): ViewMessage {
	const m: ViewMessage = {
		id: p.ack?.id ?? localMessageId(p.clientId),
		// ASSUMPTION: an unacknowledged send sorts after every stored message.
		seq: p.ack?.seq ?? Number.MAX_SAFE_INTEGER,
		at: p.at,
		from: { kind: "human" },
		text: p.frame.text,
		clientId: p.clientId,
		pending: true,
	}
	if (p.frame.replyTo) m.replyTo = p.frame.replyTo
	if (p.local?.length) m.local = p.local
	if (p.failed) m.failed = true
	if (p.reason) m.reason = p.reason
	return m
}

function patchMessage(m: ViewMessage, p: RoomPatch): ViewMessage | null {
	const f = p.frame
	if (f.t === "delete") return null
	if (f.t === "edit") {
		const { rich: _, ...rest } = m
		return { ...rest, text: f.text, editedAt: p.at }
	}
	if (f.t === "react") {
		const others = (m.reactions ?? []).filter((r) => r.by.kind !== "human")
		const reactions = f.emoji === null ? others : [...others, { by: { kind: "human" as const }, emoji: f.emoji }]
		const { reactions: _, ...rest } = m
		return reactions.length ? { ...rest, reactions } : rest
	}
	return m
}

const messageTarget = (f: RoomPatchFrame): MessageId | undefined =>
	f.t === "react" || f.t === "edit" || f.t === "delete" ? f.messageId : undefined

export function overlayMessages(messages: readonly Message[], patches: readonly RoomPatch[]): ViewMessage[] {
	if (patches.length === 0) return messages as ViewMessage[]
	const byId = new Map<MessageId, RoomPatch[]>()
	const sends: (RoomPatch & { frame: SendFrame })[] = []
	for (const p of patches) {
		if (p.frame.t === "send") sends.push(p as RoomPatch & { frame: SendFrame })
		if (p.frame.t === "answer" && p.ask) sends.push({ ...p, frame: { t: "send", clientId: p.clientId, text: humanAnswerText(p.ask, p.frame.value) ?? "", replyTo: p.ask.messageId } })
		const target = messageTarget(p.frame)
		if (target) byId.set(target, [...(byId.get(target) ?? []), p])
	}
	const out: ViewMessage[] = []
	const stored = new Set<MessageId>()
	for (const m of messages) {
		stored.add(m.id)
		let v: ViewMessage | null = m
		for (const p of byId.get(m.id) ?? []) if (v) v = patchMessage(v, p)
		if (v) out.push(v)
	}
	for (const s of sends) {
		if (s.ack && stored.has(s.ack.id)) continue
		let v: ViewMessage | null = pendingMessage(s)
		for (const p of byId.get(v.id) ?? []) if (v) v = patchMessage(v, p)
		if (v) out.push(v)
	}
	return out
}

export function overlayTasks(tasks: readonly Task[], patches: readonly RoomPatch[]): Task[] {
	let out = tasks as Task[]
	for (const p of patches) {
		if (p.frame.t !== "task") continue
		const op = p.frame.op
		if (op.op === "create") {
			const t: Task = { id: op.id, title: op.title, status: "todo", dependsOn: op.dependsOn ?? [] }
			if (op.owner) t.owner = op.owner
			out = [...out.filter((x) => x.id !== op.id), t]
		} else if (op.op === "delete") {
			out = out.filter((x) => x.id !== op.id)
		} else {
			out = out.map((x) => {
				if (x.id !== op.id) return x
				const { owner, ...rest } = x
				const next: Task = { ...rest }
				const newOwner = op.owner === undefined ? owner : (op.owner ?? undefined)
				if (newOwner) next.owner = newOwner
				if (op.title !== undefined) next.title = op.title
				if (op.status !== undefined) next.status = op.status
				if (op.note !== undefined) next.note = op.note
				return next
			})
		}
	}
	return out
}

/** The members with pending adds, renames, and removes applied. A new member joins at the end and is never the lead. */
export function overlayMembers(members: readonly Member[], patches: readonly RoomPatch[]): Member[] {
	let out = members as Member[]
	for (const p of patches) {
		const f = p.frame
		if (f.t !== "member") continue
		const op = f.op
		if (op.op === "add") {
			if (out.some((m) => m.slug === op.slug)) continue
			const m: Member = { slug: op.slug, name: op.name, lead: out.length === 0 }
			if (op.role) m.role = op.role
			if (op.model) m.model = op.model
			out = [...out, m]
		} else if (op.op === "remove") {
			out = out.filter((m) => m.slug !== op.slug)
		} else {
			out = out.map((m) => (m.slug === op.slug ? { ...m, name: op.name } : m))
		}
	}
	return out
}

const under = (name: string, path: string) => name === path || name.startsWith(`${path}/`)

/**
 * The room's files with pending `rm` and `mv` applied, by the server's rules (room/files.ts): a
 * folder is a path prefix, `mv` into an existing folder keeps the name, a file onto a file replaces it.
 */
export function overlayFiles(files: readonly FileRef[], patches: readonly RoomPatch[], folders: readonly string[] = []): FileRef[] {
	let out = files as FileRef[]
	for (const p of patches) {
		const f = p.frame
		if (f.t !== "files") continue
		const op = f.op
		if (op.op === "mkdir") continue
		if (op.op === "rm") {
			out = out.filter((x) => !op.paths.some((path) => under(x.name, path)))
			continue
		}
		const isFolder = folders.includes(op.to) || out.some((x) => x.name.startsWith(`${op.to}/`))
		const target = isFolder ? `${op.to}/${op.from.slice(op.from.lastIndexOf("/") + 1)}` : op.to
		if (target === op.from || target.startsWith(`${op.from}/`)) continue
		const moving = out.filter((x) => under(x.name, op.from))
		if (!moving.length) continue
		out = out
			.filter((x) => x.name !== target)
			.map((x) => (under(x.name, op.from) ? { ...x, name: target + x.name.slice(op.from.length) } : x))
	}
	return out
}

/** The room's folders with pending `mkdir`, `rm`, and `mv` applied, by the room's rules. */
export function overlayFolders(folders: readonly string[], patches: readonly RoomPatch[]): string[] {
	let out = folders as string[]
	for (const p of patches) {
		const f = p.frame
		if (f.t !== "files") continue
		const op = f.op
		if (op.op === "mkdir") {
			const add = op.path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))
			out = [...new Set([...out, ...add])].sort()
		} else if (op.op === "rm") {
			out = out.filter((x) => !op.paths.some((path) => under(x, path)))
		} else if (out.some((x) => under(x, op.from))) {
			const into = out.includes(op.to)
			const target = into ? `${op.to}/${op.from.slice(op.from.lastIndexOf("/") + 1)}` : op.to
			if (target === op.from || target.startsWith(`${op.from}/`)) continue
			out = [...new Set(out.map((x) => (under(x, op.from) ? target + x.slice(op.from.length) : x)))].sort()
		}
	}
	return out
}

export function overlayReadSeq(readSeq: number, patches: readonly RoomPatch[]): number {
	let out = readSeq
	for (const p of patches) if (p.frame.t === "read") out = Math.max(out, p.frame.seq)
	return out
}

/** Pinned first, then the most recently updated, as the sidebar lists them. */
export const chatOrder = (a: Chat, b: Chat) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt

export function overlayChats(chats: readonly Chat[], patches: readonly UserPatch[]): Chat[] {
	if (patches.length === 0) return [...chats].sort(chatOrder)
	let out = [...chats]
	for (const p of patches) {
		const op = p.op
		if (op.op === "create") {
			if (out.some((c) => c.roomId === op.roomId)) continue
			out.push({
				roomId: op.roomId,
				title: op.title,
				pinned: false,
				muted: false,
				lastSeq: 0,
				lastPreview: "",
				unread: 0,
				updatedAt: p.at,
				...(op.agents?.length ? { agents: op.agents } : {}),
			})
		} else if (op.op === "delete") {
			out = out.filter((c) => c.roomId !== op.roomId)
		} else {
			out = out.map((c) => {
				if (c.roomId !== op.roomId) return c
				if (op.op === "rename") return { ...c, title: op.title }
				if (op.op === "pin") return { ...c, pinned: op.pinned }
				if (op.op === "private") return { ...c, private: op.private }
				return { ...c, muted: op.muted }
			})
		}
	}
	return out.sort(chatOrder)
}
