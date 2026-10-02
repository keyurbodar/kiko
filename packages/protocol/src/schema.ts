// Effect schemas for the wire types, for the server and the CLI. The client
// never imports this entry: it trusts frames from its own server.
//
// The plain types in the other files are the source of truth. The block at the
// end of this file fails the typecheck when a schema and its type disagree.

import * as Schema from "effect/Schema"
import { isAgentSlug, isRoomId } from "./ids"
import type * as P from "./index"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))
const opaque = <T extends string>() => Id.pipe(Schema.refine((value): value is T => true))

export const UserId = opaque<P.UserId>()
export const RoomId = Schema.String.pipe(Schema.refine(isRoomId))
export const MessageId = opaque<P.MessageId>()
export const AgentSlug = Schema.String.pipe(Schema.refine(isAgentSlug))

// Envelope

export const SystemReason = Schema.Literals(["task_unblocked", "reminder", "approval_result", "run_budget", "limit"])

const Human = Schema.Struct({ kind: Schema.Literal("human") })
const AgentRef = Schema.Struct({ kind: Schema.Literal("agent"), slug: AgentSlug })
const System = Schema.Struct({ kind: Schema.Literal("system"), reason: SystemReason })

export const Sender = Schema.Union([Human, AgentRef, System])
export const Actor = Schema.Union([Human, AgentRef])

export const Envelope = Schema.Struct({
	id: Id,
	roomId: RoomId,
	from: Sender,
	body: Schema.String,
	replyTo: Schema.optionalKey(MessageId),
	hop: Count,
	rootId: Id,
	tainted: Schema.Boolean,
	seq: Count,
})

// Rich text

const inlines = Schema.Array(Schema.suspend((): Schema.Codec<P.Inline, unknown> => Inline))
const blocks = Schema.Array(Schema.suspend((): Schema.Codec<P.Block, unknown> => Block))

export const Inline: Schema.Codec<P.Inline, unknown> = Schema.Union([
	Schema.Struct({ t: Schema.Literal("text"), text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("bold"), children: inlines }),
	Schema.Struct({ t: Schema.Literal("italic"), children: inlines }),
	Schema.Struct({ t: Schema.Literal("strike"), children: inlines }),
	Schema.Struct({ t: Schema.Literal("code"), text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("link"), href: Schema.String, children: inlines }),
	Schema.Struct({ t: Schema.Literal("mention"), slug: AgentSlug }),
])

export const Block: Schema.Codec<P.Block, unknown> = Schema.Union([
	Schema.Struct({ t: Schema.Literal("paragraph"), children: inlines }),
	Schema.Struct({ t: Schema.Literal("heading"), level: Schema.Literals([1, 2, 3, 4, 5, 6]), children: inlines }),
	Schema.Struct({ t: Schema.Literal("list"), start: Schema.optionalKey(Count), items: Schema.Array(blocks) }),
	Schema.Struct({ t: Schema.Literal("quote"), children: blocks }),
	Schema.Struct({ t: Schema.Literal("code_block"), lang: Schema.optionalKey(Schema.String), text: Schema.String }),
	Schema.Struct({
		t: Schema.Literal("table"),
		align: Schema.Array(Schema.NullOr(Schema.Literals(["left", "center", "right"]))),
		head: Schema.Array(inlines),
		rows: Schema.Array(Schema.Array(inlines)),
	}),
])

export const RichText = blocks

// Room

export const AgentState = Schema.Literals(["idle", "typing", "working"])

export const FileRef = Schema.Struct({
	id: Id,
	name: Schema.String,
	size: Count,
	type: Schema.String,
	width: Schema.optionalKey(Count),
	height: Schema.optionalKey(Count),
	thumbhash: Schema.optionalKey(Schema.String),
})

export const Reaction = Schema.Struct({ by: Actor, emoji: Schema.String })

export const RunRef = Schema.Struct({ runId: Id, attempt: Count, index: Count })

const stored = { seq: Count, at: Count }

export const Message = Schema.Struct({
	id: MessageId,
	...stored,
	from: Sender,
	text: Schema.String,
	rich: Schema.optionalKey(RichText),
	replyTo: Schema.optionalKey(MessageId),
	files: Schema.optionalKey(Schema.Array(FileRef)),
	run: Schema.optionalKey(RunRef),
	editedAt: Schema.optionalKey(Count),
	reactions: Schema.optionalKey(Schema.Array(Reaction)),
})

export const Member = Schema.Struct({
	slug: AgentSlug,
	name: Schema.String,
	lead: Schema.Boolean,
	role: Schema.optionalKey(Schema.String),
	model: Schema.optionalKey(Schema.String),
})

export const MemberOp = Schema.Union([
	Schema.Struct({
		op: Schema.Literal("add"),
		slug: AgentSlug,
		name: Schema.String,
		role: Schema.optionalKey(Schema.String),
		model: Schema.optionalKey(Schema.String),
	}),
	Schema.Struct({ op: Schema.Literal("remove"), slug: AgentSlug }),
	Schema.Struct({ op: Schema.Literal("rename"), slug: AgentSlug, name: Schema.String }),
])

export const TaskStatus = Schema.Literals(["todo", "doing", "blocked", "review", "done", "cancelled"])

export const Task = Schema.Struct({
	id: Id,
	title: Schema.String,
	status: TaskStatus,
	owner: Schema.optionalKey(AgentSlug),
	dependsOn: Schema.Array(Id),
	note: Schema.optionalKey(Schema.String),
})

export const TaskOp = Schema.Union([
	Schema.Struct({
		op: Schema.Literal("create"),
		id: Id,
		title: Schema.String,
		owner: Schema.optionalKey(AgentSlug),
		dependsOn: Schema.optionalKey(Schema.Array(Id)),
	}),
	Schema.Struct({
		op: Schema.Literal("update"),
		id: Id,
		title: Schema.optionalKey(Schema.String),
		status: Schema.optionalKey(TaskStatus),
		owner: Schema.optionalKey(Schema.NullOr(AgentSlug)),
		note: Schema.optionalKey(Schema.String),
	}),
	Schema.Struct({ op: Schema.Literal("delete"), id: Id }),
])

export const Approval = Schema.Struct({
	id: Id,
	slug: AgentSlug,
	tool: Schema.String,
	summary: Schema.String,
	state: Schema.Literals(["pending", "accepted", "declined", "expired"]),
	expiresAt: Count,
})

export const RoomEvent = Schema.Union([
	Schema.Struct({ t: Schema.Literal("message"), clientId: Schema.optionalKey(Id), ...Message.fields }),
	Schema.Struct({
		...stored,
		t: Schema.Literal("edit"),
		messageId: MessageId,
		text: Schema.String,
		rich: Schema.optionalKey(RichText),
	}),
	Schema.Struct({ ...stored, t: Schema.Literal("delete"), messageIds: Schema.Array(MessageId) }),
	Schema.Struct({
		...stored,
		t: Schema.Literal("react"),
		messageId: MessageId,
		by: Actor,
		emoji: Schema.NullOr(Schema.String),
	}),
	Schema.Struct({ ...stored, t: Schema.Literal("read"), upTo: Count }),
	Schema.Struct({ ...stored, t: Schema.Literal("member"), member: Member }),
	Schema.Struct({ ...stored, t: Schema.Literal("member_removed"), slug: AgentSlug }),
	Schema.Struct({ ...stored, t: Schema.Literal("task"), task: Task }),
	Schema.Struct({ ...stored, t: Schema.Literal("task_removed"), id: Id }),
	Schema.Struct({ ...stored, t: Schema.Literal("approval"), approval: Approval }),
	Schema.Struct({ ...stored, t: Schema.Literal("file"), file: FileRef }),
	Schema.Struct({ ...stored, t: Schema.Literal("no_provider"), slug: AgentSlug, provider: Schema.String }),
])

export const RoomSnapshot = Schema.Struct({
	seq: Count,
	readSeq: Count,
	members: Schema.Array(Member),
	messages: Schema.Array(Message),
	tasks: Schema.Array(Task),
	approvals: Schema.Array(Approval),
	files: Schema.Array(FileRef),
})

const Hello = Schema.Struct({ t: Schema.Literal("hello"), lastSeq: Count })

export const ClientToRoom = Schema.Union([
	Hello,
	Schema.Struct({
		t: Schema.Literal("send"),
		clientId: Id,
		text: Schema.String,
		replyTo: Schema.optionalKey(MessageId),
		files: Schema.optionalKey(Schema.Array(FileRef)),
	}),
	Schema.Struct({ t: Schema.Literal("react"), messageId: MessageId, emoji: Schema.NullOr(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("edit"), messageId: MessageId, text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("delete"), messageId: MessageId }),
	Schema.Struct({ t: Schema.Literal("read"), seq: Count }),
	Schema.Struct({ t: Schema.Literal("typing") }),
	Schema.Struct({ t: Schema.Literal("stop") }),
	Schema.Struct({ t: Schema.Literal("approve"), approvalId: Id, action: Schema.Literals(["accept", "decline"]) }),
	Schema.Struct({ t: Schema.Literal("task"), op: TaskOp }),
	Schema.Struct({ t: Schema.Literal("member"), op: MemberOp }),
	Schema.Struct({
		t: Schema.Literal("search"),
		query: Schema.String,
		before: Schema.optionalKey(Count),
		limit: Schema.optionalKey(Count),
	}),
	Schema.Struct({
		t: Schema.Literal("catalog"),
		kind: Schema.Literals(["links", "media"]),
		before: Schema.optionalKey(Count),
		limit: Schema.optionalKey(Count),
	}),
])

export const CatalogItem = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("link"), url: Schema.String, site: Schema.String, messageId: MessageId, seq: Count, at: Count }),
	Schema.Struct({ kind: Schema.Literal("media"), file: FileRef, messageId: MessageId, seq: Count, at: Count }),
])

export const RoomToClient = Schema.Union([
	Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(RoomEvent) }),
	Schema.Struct({ t: Schema.Literal("ack"), clientId: Id, id: MessageId, seq: Count }),
	Schema.Struct({ t: Schema.Literal("reset"), snapshot: RoomSnapshot }),
	Schema.Struct({ t: Schema.Literal("typing"), who: Schema.Array(AgentSlug) }),
	Schema.Struct({ t: Schema.Literal("draft"), slug: AgentSlug, runId: Id, index: Count, text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("status"), slug: AgentSlug, state: AgentState }),
	Schema.Struct({
		t: Schema.Literal("member_refused"),
		op: MemberOp,
		reason: Schema.Literals(["limit", "exists", "unknown", "last", "reserved"]),
	}),
	Schema.Struct({
		t: Schema.Literal("search"),
		query: Schema.String,
		before: Schema.optionalKey(Count),
		results: Schema.Array(Schema.Struct({ id: MessageId, seq: Count, snippet: Schema.String })),
		next: Schema.NullOr(Count),
	}),
	Schema.Struct({
		t: Schema.Literal("catalog"),
		kind: Schema.Literals(["links", "media"]),
		before: Schema.optionalKey(Count),
		items: Schema.Array(CatalogItem),
		next: Schema.NullOr(Count),
	}),
])

// User

export const Chat = Schema.Struct({
	roomId: RoomId,
	title: Schema.String,
	pinned: Schema.Boolean,
	muted: Schema.Boolean,
	lastSeq: Count,
	lastPreview: Schema.String,
	unread: Count,
	updatedAt: Count,
	agents: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const Agent = Schema.Struct({ id: Id, name: Schema.String, slug: AgentSlug, prompt: Schema.String, model: Schema.String })

export const AgentOp = Schema.Struct({ op: Schema.Literal("create"), agent: Agent })

export const ChatOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("create"), roomId: RoomId, title: Schema.String, agents: Schema.optionalKey(Schema.Array(Schema.String)) }),
	Schema.Struct({ op: Schema.Literal("rename"), roomId: RoomId, title: Schema.String }),
	Schema.Struct({ op: Schema.Literal("pin"), roomId: RoomId, pinned: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("mute"), roomId: RoomId, muted: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("delete"), roomId: RoomId }),
])

export const UserEvent = Schema.Union([
	Schema.Struct({ ...stored, t: Schema.Literal("chat"), chat: Chat }),
	Schema.Struct({ ...stored, t: Schema.Literal("chat_removed"), roomId: RoomId }),
	Schema.Struct({ ...stored, t: Schema.Literal("agent"), agent: Agent }),
	Schema.Struct({ ...stored, t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
])

export const UserSnapshot = Schema.Struct({
	seq: Count,
	chats: Schema.Array(Chat),
	agents: Schema.optionalKey(Schema.Array(Agent)),
	theme: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

// Memory

const MemoryType = Schema.Literals(["profile", "now", "todo", "preference", "person", "organization", "conversation", "procedure"])
const Provenance = Schema.Struct({ author: Id, tainted: Schema.optionalKey(Schema.Boolean) })

export const MemoryRecord = Schema.Struct({
	id: Id,
	type: MemoryType,
	title: Schema.String,
	aliases: Schema.Array(Schema.String),
	body: Schema.String,
	pinned: Schema.Boolean,
	archived: Schema.Boolean,
	uses: Count,
	lastUsedAt: Count,
	createdAt: Count,
	updatedAt: Count,
	version: Count,
})

export const MemoryVersion = Schema.Struct({ recordId: Id, version: Count, body: Schema.String, author: Schema.String, at: Count })

export const MemoryOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("list"), includeArchived: Schema.optionalKey(Schema.Boolean) }),
	Schema.Struct({ op: Schema.Literal("search"), query: Schema.String, limit: Schema.optionalKey(Count) }),
	Schema.Struct({ op: Schema.Literal("view"), id: Id }),
	Schema.Struct({ op: Schema.Literal("history"), id: Id }),
	Schema.Struct({
		op: Schema.Literal("create"),
		id: Schema.optionalKey(Id),
		type: MemoryType,
		title: Id,
		aliases: Schema.optionalKey(Schema.Array(Schema.String)),
		body: Schema.optionalKey(Schema.String),
		author: Id,
	}),
	Schema.Struct({ op: Schema.Literal("append"), id: Id, fact: Id, provenance: Provenance }),
	Schema.Struct({ op: Schema.Literal("replace"), id: Id, body: Schema.String, author: Id }),
	Schema.Struct({ op: Schema.Literal("pin"), id: Id, pinned: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("archive"), id: Id, archived: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("remove"), id: Id }),
])

export const MemoryResult = Schema.Union([
	Schema.Struct({ ok: Schema.Literal(true), records: Schema.Array(MemoryRecord) }),
	Schema.Struct({ ok: Schema.Literal(true), record: Schema.NullOr(MemoryRecord) }),
	Schema.Struct({ ok: Schema.Literal(true), versions: Schema.Array(MemoryVersion) }),
	Schema.Struct({ ok: Schema.Literal(true), removed: Schema.Boolean }),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])

export const ExecutorStatus = Schema.Struct({
	connected: Schema.Boolean,
	kind: Schema.NullOr(Schema.Union([Schema.Literal("oauth"), Schema.Literal("api_key")])),
	pending: Schema.Boolean,
	expiresAt: Schema.NullOr(Schema.Number),
	issuedAt: Schema.NullOr(Schema.Number),
	refreshable: Schema.Boolean,
	organization: Schema.optionalKey(Schema.String),
	rows: Schema.Number,
})

export const ExecutorResult = Schema.Union([
	Schema.Struct({
		ok: Schema.Literal(true),
		status: ExecutorStatus,
		authorizeUrl: Schema.optionalKey(Schema.String),
		tools: Schema.optionalKey(Schema.Array(Schema.String)),
	}),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])

export const ClientToUser = Schema.Union([
	Hello,
	Schema.Struct({ t: Schema.Literal("chat"), op: ChatOp }),
	Schema.Struct({ t: Schema.Literal("agent"), op: AgentOp }),
	Schema.Struct({ t: Schema.Literal("memory"), reqId: Id, op: MemoryOp }),
	Schema.Struct({ t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("search"), query: Schema.String }),
	Schema.Struct({ t: Schema.Literal("connectExecutor"), reqId: Id, apiKey: Schema.optionalKey(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("disconnectExecutor"), reqId: Id }),
	Schema.Struct({
		t: Schema.Literal("executorStatus"),
		reqId: Id,
		refresh: Schema.optionalKey(Schema.Boolean),
		tools: Schema.optionalKey(Schema.Boolean),
	}),
	Schema.Struct({ t: Schema.Literal("login.start"), loginId: Id, provider: Id }),
	Schema.Struct({ t: Schema.Literal("login.answer"), loginId: Id, promptId: Id, value: Schema.String }),
	Schema.Struct({ t: Schema.Literal("login.cancel"), loginId: Id }),
])

export const LoginEvent = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("info"),
		message: Schema.String,
		links: Schema.optionalKey(
			Schema.Array(Schema.Struct({ url: Schema.String, label: Schema.optionalKey(Schema.String) })),
		),
	}),
	Schema.Struct({ type: Schema.Literal("auth_url"), url: Schema.String, instructions: Schema.optionalKey(Schema.String) }),
	Schema.Struct({
		type: Schema.Literal("device_code"),
		userCode: Schema.String,
		verificationUri: Schema.String,
		intervalSeconds: Schema.optionalKey(Schema.Number),
		expiresInSeconds: Schema.optionalKey(Schema.Number),
	}),
	Schema.Struct({ type: Schema.Literal("progress"), message: Schema.String }),
])

export const LoginPrompt = Schema.Union([
	Schema.Struct({
		type: Schema.Literals(["text", "secret", "manual_code"]),
		message: Schema.String,
		placeholder: Schema.optionalKey(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("select"),
		message: Schema.String,
		options: Schema.Array(
			Schema.Struct({ id: Schema.String, label: Schema.String, description: Schema.optionalKey(Schema.String) }),
		),
	}),
])

export const LoginErrorReason = Schema.Literals(["unsupported", "disabled", "unknown", "cancelled", "timeout", "failed"])

export const UserToClient = Schema.Union([
	Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(UserEvent) }),
	Schema.Struct({ t: Schema.Literal("reset"), snapshot: UserSnapshot }),
	Schema.Struct({ t: Schema.Literal("memory_result"), reqId: Id, result: MemoryResult }),
	Schema.Struct({ t: Schema.Literal("search"), query: Schema.String, chats: Schema.Array(Chat) }),
	Schema.Struct({ t: Schema.Literal("executor"), reqId: Schema.optionalKey(Id), result: ExecutorResult }),
	Schema.Struct({ t: Schema.Literal("login.notify"), loginId: Id, event: LoginEvent }),
	Schema.Struct({ t: Schema.Literal("login.prompt"), loginId: Id, promptId: Id, prompt: LoginPrompt }),
	Schema.Struct({
		t: Schema.Literal("login.done"),
		loginId: Id,
		provider: Schema.Struct({ provider: Id, kind: Schema.Literals(["api_key", "oauth"]), last4: Schema.String }),
	}),
	Schema.Struct({ t: Schema.Literal("login.error"), loginId: Id, reason: LoginErrorReason, message: Schema.String }),
])

// A schema and its plain type must accept exactly the same values. `Inline`
// and `Block` are recursive, so their annotations check them instead.

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

export type InSync = Assert<
	| Same<typeof UserId.Type, P.UserId>
	| Same<typeof RoomId.Type, P.RoomId>
	| Same<typeof MessageId.Type, P.MessageId>
	| Same<typeof AgentSlug.Type, P.AgentSlug>
	| Same<typeof Sender.Type, P.Sender>
	| Same<typeof Actor.Type, P.Actor>
	| Same<typeof Envelope.Type, P.Envelope>
	| Same<typeof RichText.Type, P.RichText>
	| Same<typeof Message.Type, P.Message>
	| Same<typeof TaskOp.Type, P.TaskOp>
	| Same<typeof MemberOp.Type, P.MemberOp>
	| Same<typeof Member.Type, P.Member>
	| Same<typeof RoomEvent.Type, P.RoomEvent>
	| Same<typeof RoomSnapshot.Type, P.RoomSnapshot>
	| Same<typeof ClientToRoom.Type, P.ClientToRoom>
	| Same<typeof RoomToClient.Type, P.RoomToClient>
	| Same<typeof ChatOp.Type, P.ChatOp>
	| Same<typeof Agent.Type, P.Agent>
	| Same<typeof UserEvent.Type, P.UserEvent>
	| Same<typeof UserSnapshot.Type, P.UserSnapshot>
	| Same<typeof MemoryOp.Type, P.MemoryOp>
	| Same<typeof MemoryResult.Type, P.MemoryResult>
	| Same<typeof ExecutorStatus.Type, P.ExecutorStatus>
	| Same<typeof ExecutorResult.Type, P.ExecutorResult>
	| Same<typeof ClientToUser.Type, P.ClientToUser>
	| Same<typeof UserToClient.Type, P.UserToClient>
>
