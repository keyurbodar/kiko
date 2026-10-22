import { humanAnswerText } from "@kiko/protocol"

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

export type RoomPatchFrame = Exclude<ClientToRoom, { t: "hello" } | { t: "typing" } | { t: "stop" } | { t: "search" } | { t: "history" } | { t: "model" } | { t: "retry" } | { t: "steps" }>
export type SendFrame = Extract<ClientToRoom, { t: "send" }>

export type RoomPatch = {
	clientId: string
	ask?: HumanAsk
	frame: RoomPatchFrame
	at: number
	sentAt?: number
	ack?: { id: MessageId; seq: number }
	local?: readonly LocalAttachment[]
	failed?: boolean
	reason?: string
}

export type LocalAttachment = { src: string; name: string; type: string; size: number }

export type UserPatch = {
	clientId: string
	op: ChatOp
	at: number
	sentAt?: number
}

export type ViewMessage = Message & { clientId?: string; pending?: boolean; local?: readonly LocalAttachment[]; failed?: boolean; reason?: string }

export const PATCH_TTL_MS = 15_000

export const localMessageId = (clientId: string) => `local:${clientId}` as MessageId

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
	files: (f, e) => {
		const op = f.op
		if (op.op === "mkdir") return e.t === "folders" && e.folders.includes(op.path)
		if (op.op === "rm") return e.t === "file_removed"
		if (e.t === "file") return e.file.name === op.to || e.file.name.startsWith(`${op.to}/`)
		if (e.t === "folders") return e.folders.some((f) => f === op.to || f.startsWith(`${op.to}/`))
		return false
	},
}

export function roomConfirmedBy(patch: RoomPatch, event: RoomEvent): boolean {
	const check = roomConfirms[patch.frame.t] as ((f: RoomPatchFrame, e: RoomEvent, c: string) => boolean) | undefined
	return check ? check(patch.frame, event, patch.clientId) : true
}

export function settleRoom(patches: readonly RoomPatch[], events: readonly RoomEvent[], appliedSeq: number): RoomPatch[] {
	return patches.filter(
		(p) => !(p.ack && p.ack.seq <= appliedSeq) && !events.some((e) => roomConfirmedBy(p, e)),
	)
}

export function settleSends(patches: readonly RoomPatch[], snapshot: { messages: readonly Message[]; seq: number }): RoomPatch[] {
	const landed = new Set<string>()
	for (const m of snapshot.messages) if (m.clientId) landed.add(m.clientId)
	if (!landed.size) return [...patches]
	return patches.filter((p) => !(p.frame.t === "send" && landed.has(p.clientId)))
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

export function expire<P extends { sentAt?: number; frame?: RoomPatchFrame }>(
	patches: readonly P[],
	now: number,
	ttlMs = PATCH_TTL_MS,
): P[] {
	return patches.filter((p) => p.frame?.t === "send" || p.frame?.t === "read" || p.sentAt === undefined || now - p.sentAt < ttlMs)
}

function pendingMessage(p: RoomPatch & { frame: SendFrame }): ViewMessage {
	const m: ViewMessage = {
		id: p.ack?.id ?? localMessageId(p.clientId),
		seq: p.ack?.seq ?? Number.MAX_SAFE_INTEGER,
		at: p.at,
		from: { kind: "human" },
		text: p.frame.text,
		clientId: p.clientId,
		pending: true,
	}
	if (p.frame.replyTo) m.replyTo = p.frame.replyTo
	if (p.frame.replyTo && p.frame.quote) m.quote = p.frame.quote
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
		const v = applyMessagePatches(m, byId.get(m.id) ?? [])
		if (v) out.push(v)
	}
	for (const s of sends) {
		if (s.ack && stored.has(s.ack.id)) continue
		const pending = pendingMessage(s)
		const v = applyMessagePatches(pending, byId.get(pending.id) ?? [])
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

function applyMessagePatches(message: ViewMessage, patches: readonly RoomPatch[]): ViewMessage | null {
	let value: ViewMessage | null = message
	for (const patch of patches) if (value) value = patchMessage(value, patch)
	return value
}
