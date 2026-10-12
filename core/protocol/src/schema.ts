// Effect schemas for the wire types, for the server and the CLI. The client
// never imports this entry: it trusts frames from its own server.

import * as Schema from "effect/Schema"
import { checkBundle, checkManifest } from "./extensions"
import { isAgentSlug, isRoomId } from "./ids"
import type * as P from "./index"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))
const opaque = <T extends string>() => Id.pipe(Schema.refine((value): value is T => true))

export const UserId = opaque<P.UserId>()
export const RoomId = Schema.String.pipe(Schema.refine(isRoomId))
export const MessageId = opaque<P.MessageId>()
export const AgentSlug = Schema.String.pipe(Schema.refine(isAgentSlug))


export const SystemReason = Schema.Literals(["task_unblocked", "reminder", "run_budget", "limit", "files", "created", "routine", "stalled", "initiative"])

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
	seq: Count,
})


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


export const AgentState = Schema.Literals(["idle", "typing", "working"])

export const FileRef = Schema.Struct({
	id: Id,
	name: Schema.String,
	size: Count,
	type: Schema.String,
})

export const PendingAttachment = Schema.Struct({
	pendingId: Id,
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
	type: Schema.String.check(Schema.isMaxLength(255)),
	size: Count,
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
	goto: Schema.optionalKey(RoomId),
	quote: Schema.optionalKey(Schema.String),
	to: Schema.optionalKey(Schema.Union([AgentSlug, Schema.Literal("all")])),
	initiative: Schema.optionalKey(Schema.Struct({ reason: Schema.String })),
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


const Short = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

export const WebhookMatch = Schema.Struct({
	path: Short(200),
	equals: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
	contains: Schema.optionalKey(Short(200)),
})

export const Trigger = Schema.Union([
	Schema.Struct({ on: Schema.Literal("time"), at: Short(64), rrule: Schema.optionalKey(Short(300)) }),
	Schema.Struct({ on: Schema.Literal("task"), status: Schema.optionalKey(Schema.Array(TaskStatus)) }),
	Schema.Struct({ on: Schema.Literal("message"), from: Schema.Literals(["human", "agent", "any"]), contains: Schema.optionalKey(Short(200)) }),
	Schema.Struct({ on: Schema.Literal("file"), path: Short(300) }),
	Schema.Struct({ on: Schema.Literal("webhook"), match: Schema.optionalKey(Schema.Array(WebhookMatch).check(Schema.isMaxLength(8))) }),
	Schema.Struct({
		on: Schema.Literal("watch"),
		url: Short(2000),
		everyMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(15), Schema.isLessThanOrEqualTo(10_080)),
		extension: Schema.optionalKey(Short(64)),
		headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	}),
])

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
	Schema.Struct({ ...stored, t: Schema.Literal("file"), file: FileRef }),
	Schema.Struct({ ...stored, t: Schema.Literal("file_removed"), ids: Schema.Array(Id) }),
	Schema.Struct({ ...stored, t: Schema.Literal("folders"), folders: Schema.Array(Schema.String) }),
	Schema.Struct({ ...stored, t: Schema.Literal("no_provider"), slug: AgentSlug, provider: Schema.String }),
])

export const RoomSnapshot = Schema.Struct({
	seq: Count,
	readSeq: Count,
	members: Schema.Array(Member),
	messages: Schema.Array(Message),
	tasks: Schema.Array(Task),
	files: Schema.Array(FileRef),
	folders: Schema.Array(Schema.String),
})

const Hello = Schema.Struct({ t: Schema.Literal("hello"), lastSeq: Count })

const FilePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))

export const FileOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("rm"), paths: Schema.Array(FilePath).check(Schema.isMinLength(1), Schema.isMaxLength(200)), recursive: Schema.optionalKey(Schema.Boolean) }),
	Schema.Struct({ op: Schema.Literal("mv"), from: FilePath, to: FilePath }),
	Schema.Struct({ op: Schema.Literal("mkdir"), path: FilePath }),
])

export const ClientToRoom = Schema.Union([
	Hello,
	Schema.Struct({
		t: Schema.Literal("send"),
		clientId: Id,
		text: Schema.String,
		replyTo: Schema.optionalKey(MessageId),
		quote: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
		attachments: Schema.optionalKey(Schema.Array(PendingAttachment)),
	}),
	Schema.Struct({ t: Schema.Literal("react"), messageId: MessageId, emoji: Schema.NullOr(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("edit"), messageId: MessageId, text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("delete"), messageId: MessageId }),
	Schema.Struct({ t: Schema.Literal("read"), seq: Count }),
	Schema.Struct({ t: Schema.Literal("typing") }),
	Schema.Struct({ t: Schema.Literal("stop") }),
	Schema.Struct({ t: Schema.Literal("model"), ref: Schema.String, slug: Schema.optional(AgentSlug) }),
	Schema.Struct({ t: Schema.Literal("task"), op: TaskOp }),
	Schema.Struct({ t: Schema.Literal("member"), op: MemberOp }),
	Schema.Struct({ t: Schema.Literal("files"), op: FileOp }),
	Schema.Struct({
		t: Schema.Literal("search"),
		query: Schema.String,
		before: Schema.optionalKey(Count),
		limit: Schema.optionalKey(Count),
	}),
	Schema.Struct({ t: Schema.Literal("history"), seq: Count, before: Count, after: Count }),
])

export const RoomToClient = Schema.Union([
	Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(RoomEvent) }),
	Schema.Struct({ t: Schema.Literal("ack"), clientId: Id, id: MessageId, seq: Count }),
	Schema.Struct({ t: Schema.Literal("reset"), snapshot: RoomSnapshot }),
	Schema.Struct({ t: Schema.Literal("typing"), who: Schema.Array(AgentSlug) }),
	Schema.Struct({ t: Schema.Literal("draft"), slug: AgentSlug, runId: Id, index: Count, text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("status"), slug: AgentSlug, state: AgentState, doing: Schema.optionalKey(Schema.String) }),
	Schema.Struct({
		t: Schema.Literal("member_refused"),
		op: MemberOp,
		reason: Schema.Literals(["limit", "exists", "unknown", "last", "reserved", "chief"]),
	}),
	Schema.Struct({ t: Schema.Literal("send_refused"), clientId: Id, reason: Schema.String }),
	Schema.Struct({ t: Schema.Literal("files_refused"), op: FileOp, reason: Schema.String }),
	Schema.Struct({
		t: Schema.Literal("search"),
		query: Schema.String,
		before: Schema.optionalKey(Count),
		results: Schema.Array(Schema.Struct({ id: MessageId, seq: Count, at: Count, from: Sender, snippet: Schema.String })),
		next: Schema.NullOr(Count),
	}),
	Schema.Struct({
		t: Schema.Literal("history"),
		seq: Count,
		before: Count,
		after: Count,
		messages: Schema.Array(Message),
	}),
])


export const ChatLast = Schema.Struct({
	from: Schema.Literals(["human", "agent", "system"]),
	name: Schema.optionalKey(Schema.String),
	kind: Schema.Literals(["text", "photo", "video", "album", "file", "voice", "audio", "link", "react", "joined", "left", "renamed", "created", "notice"]),
	text: Schema.optionalKey(Schema.String),
	file: Schema.optionalKey(Schema.String),
	count: Schema.optionalKey(Count),
	emoji: Schema.optionalKey(Schema.String),
	at: Count,
})

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
	yuki: Schema.optionalKey(Schema.Literal(true)),
	private: Schema.optionalKey(Schema.Boolean),
	temp: Schema.optionalKey(Schema.Literal(true)),
	last: Schema.optionalKey(ChatLast),
	mentions: Schema.optionalKey(Count),
	group: Schema.optionalKey(Schema.Literal(true)),
})

export const Agent = Schema.Struct({ id: Id, name: Schema.String, slug: AgentSlug, prompt: Schema.String, model: Schema.String })

export const AgentOp = Schema.Struct({ op: Schema.Literal("create"), agent: Agent })

export const ChatOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("create"), roomId: RoomId, title: Schema.String, agents: Schema.optionalKey(Schema.Array(Schema.String)), temp: Schema.optionalKey(Schema.Literal(true)) }),
	Schema.Struct({ op: Schema.Literal("keep"), roomId: RoomId, title: Schema.String, agents: Schema.Array(Schema.String) }),
	Schema.Struct({ op: Schema.Literal("rename"), roomId: RoomId, title: Schema.String }),
	Schema.Struct({ op: Schema.Literal("pin"), roomId: RoomId, pinned: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("mute"), roomId: RoomId, muted: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("private"), roomId: RoomId, private: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("delete"), roomId: RoomId }),
])

// Extensions (architecture section 24). The manifest and the bundle are checked by the same pure
// functions the server runs, so a frame that passes here is one the server would accept.

export const ExtensionManifest = Schema.Unknown.pipe(Schema.refine((u): u is P.ExtensionManifest => checkManifest(u).ok))
export const ExtensionBundle = Schema.Unknown.pipe(Schema.refine((u): u is P.ExtensionBundle => checkBundle(u).ok))
const ExtensionSource = Schema.Literals(["human", "agent", "catalog"])

export const ExtensionInfo = Schema.Struct({
	name: Id,
	version: Id,
	description: Schema.String,
	hash: Id,
	enabled: Schema.Boolean,
	agents: Schema.NullOr(Schema.Array(AgentSlug)),
	source: ExtensionSource,
	by: Schema.optionalKey(AgentSlug),
	room: Schema.optionalKey(RoomId),
	manifest: ExtensionManifest,
	secrets: Schema.Array(Schema.Struct({ name: Id, set: Schema.Boolean })),
	error: Schema.optionalKey(Schema.String),
	installedAt: Count,
	updatedAt: Count,
})

export const ExtensionProposal = Schema.Struct({
	id: Id,
	name: Id,
	version: Id,
	hash: Id,
	source: ExtensionSource,
	by: Schema.optionalKey(AgentSlug),
	room: Schema.optionalKey(RoomId),
	bundle: ExtensionBundle,
	replaces: Schema.optionalKey(Id),
	createdAt: Count,
})

export const ExtensionCatalogEntry = Schema.Struct({ name: Id, version: Id, description: Schema.String, bundle: ExtensionBundle })

export const ExtensionOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("propose"), bundle: Schema.Unknown, room: Schema.optionalKey(RoomId) }),
	Schema.Struct({ op: Schema.Literal("catalog") }),
	Schema.Struct({ op: Schema.Literal("propose_catalog"), name: Id }),
	Schema.Struct({ op: Schema.Literal("install"), id: Id }),
	Schema.Struct({ op: Schema.Literal("decline"), id: Id }),
	Schema.Struct({ op: Schema.Literal("enable"), name: Id, enabled: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("agents"), name: Id, agents: Schema.NullOr(Schema.Array(AgentSlug)) }),
	Schema.Struct({ op: Schema.Literal("secret"), name: Id, secret: Id, value: Schema.NullOr(Schema.String) }),
	Schema.Struct({ op: Schema.Literal("uninstall"), name: Id }),
	Schema.Struct({ op: Schema.Literal("source"), name: Id }),
])

export const ExtensionResult = Schema.Union([
	Schema.Struct({
		ok: Schema.Literal(true),
		proposal: Schema.optionalKey(ExtensionProposal),
		extension: Schema.optionalKey(ExtensionInfo),
		bundle: Schema.optionalKey(ExtensionBundle),
		catalog: Schema.optionalKey(Schema.Array(ExtensionCatalogEntry)),
	}),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String, problems: Schema.optionalKey(Schema.Array(Schema.String)) }),
])

export const UserEvent = Schema.Union([
	Schema.Struct({ ...stored, t: Schema.Literal("chat"), chat: Chat }),
	Schema.Struct({ ...stored, t: Schema.Literal("chat_removed"), roomId: RoomId }),
	Schema.Struct({ ...stored, t: Schema.Literal("agent"), agent: Agent }),
	Schema.Struct({ ...stored, t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
	Schema.Struct({ ...stored, t: Schema.Literal("file"), file: FileRef }),
	Schema.Struct({ ...stored, t: Schema.Literal("file_removed"), ids: Schema.Array(Id) }),
	Schema.Struct({ ...stored, t: Schema.Literal("folders"), folders: Schema.Array(Schema.String) }),
	Schema.Struct({ ...stored, t: Schema.Literal("extension"), extension: ExtensionInfo }),
	Schema.Struct({ ...stored, t: Schema.Literal("extension_removed"), name: Id }),
	Schema.Struct({ ...stored, t: Schema.Literal("extension_proposal"), proposal: ExtensionProposal }),
	Schema.Struct({ ...stored, t: Schema.Literal("extension_proposal_removed"), id: Id }),
])

export const UserSnapshot = Schema.Struct({
	seq: Count,
	chats: Schema.Array(Chat),
	agents: Schema.optionalKey(Schema.Array(Agent)),
	theme: Schema.optionalKey(Schema.NullOr(Schema.String)),
	home: Schema.Struct({ files: Schema.Array(FileRef), folders: Schema.Array(Schema.String) }),
	lastChat: Schema.optionalKey(RoomId),
	extensions: Schema.optionalKey(Schema.Array(ExtensionInfo)),
	proposals: Schema.optionalKey(Schema.Array(ExtensionProposal)),
})


export const LifeLine = Schema.Struct({
	pos: Count,
	at: Count,
	text: Schema.String,
	source: Schema.String,
	pinned: Schema.Boolean,
	redacted: Schema.Boolean,
	supersededBy: Schema.optionalKey(Schema.NullOr(Count)),
})

const MemoryModel = Schema.NullOr(Schema.Struct({ provider: Id, modelId: Id }))

export const MemoryOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("list"), before: Schema.optionalKey(Count), limit: Schema.optionalKey(Count) }),
	Schema.Struct({ op: Schema.Literal("view") }),
	Schema.Struct({ op: Schema.Literal("search"), query: Schema.String }),
	Schema.Struct({ op: Schema.Literal("zoom"), id: Id }),
	Schema.Struct({ op: Schema.Literal("note"), text: Id }),
	Schema.Struct({ op: Schema.Literal("pin"), pos: Count, pinned: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("redact"), pos: Count }),
	Schema.Struct({ op: Schema.Literal("model") }),
	Schema.Struct({ op: Schema.Literal("set_model"), model: MemoryModel }),
])

export const MemoryResult = Schema.Union([
	Schema.Struct({ ok: Schema.Literal(true), lines: Schema.Array(LifeLine), next: Schema.NullOr(Count) }),
	Schema.Struct({ ok: Schema.Literal(true), text: Schema.Array(Schema.String) }),
	Schema.Struct({ ok: Schema.Literal(true), model: MemoryModel }),
	Schema.Struct({ ok: Schema.Literal(true) }),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])

export const ComposioStatus = Schema.Struct({ connected: Schema.Boolean, rows: Schema.Number })

export const ComposioResult = Schema.Union([
	Schema.Struct({ ok: Schema.Literal(true), status: ComposioStatus, tools: Schema.optionalKey(Schema.Array(Schema.String)), readOnly: Schema.optionalKey(Schema.Array(Schema.String)) }),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])

export const KernelStatus = Schema.Struct({
	connected: Schema.Boolean,
	broken: Schema.Boolean,
	browser: Schema.NullOr(Schema.Struct({ mode: Schema.Literals(["headless", "headful"]), tabs: Schema.Record(Schema.String, Schema.Number) })),
})

export const KernelResult = Schema.Union([
	Schema.Struct({ ok: Schema.Literal(true), status: KernelStatus }),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])

export const BrowserState = Schema.NullOr(
	Schema.Struct({
		mode: Schema.Literals(["headless", "headful"]),
		tabs: Schema.Array(Schema.Struct({ agent: Schema.String, slug: Schema.String, host: Schema.String })),
		takeover: Schema.Boolean,
		switching: Schema.Boolean,
		since: Count,
	}),
)

export const BrowserLinkResult = Schema.Union([
	Schema.Struct({ ok: Schema.Literal(true), url: Schema.String }),
	Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])

export const ClientToUser = Schema.Union([
	Hello,
	Schema.Struct({ t: Schema.Literal("home"), op: FileOp }),
	Schema.Struct({ t: Schema.Literal("chat"), op: ChatOp }),
	Schema.Struct({ t: Schema.Literal("open"), roomId: RoomId }),
	Schema.Struct({ t: Schema.Literal("agent"), op: AgentOp }),
	Schema.Struct({ t: Schema.Literal("memory"), reqId: Id, op: MemoryOp }),
	Schema.Struct({ t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("search"), query: Schema.String }),
	Schema.Struct({ t: Schema.Literal("connectComposio"), reqId: Id, apiKey: Schema.String }),
	Schema.Struct({ t: Schema.Literal("disconnectComposio"), reqId: Id }),
	Schema.Struct({ t: Schema.Literal("composioStatus"), reqId: Id, tools: Schema.optionalKey(Schema.Boolean) }),
	Schema.Struct({ t: Schema.Literal("connectKernel"), reqId: Id, apiKey: Schema.String }),
	Schema.Struct({ t: Schema.Literal("disconnectKernel"), reqId: Id }),
	Schema.Struct({ t: Schema.Literal("kernelStatus"), reqId: Id }),
	Schema.Struct({ t: Schema.Literal("browserLink"), reqId: Id, mode: Schema.Literals(["watch", "control"]) }),
	Schema.Struct({ t: Schema.Literal("handBack") }),
	Schema.Struct({ t: Schema.Literal("closeBrowser") }),
	Schema.Struct({ t: Schema.Literal("login.start"), loginId: Id, provider: Id }),
	Schema.Struct({ t: Schema.Literal("login.answer"), loginId: Id, promptId: Id, value: Schema.String }),
	Schema.Struct({ t: Schema.Literal("login.cancel"), loginId: Id }),
	Schema.Struct({ t: Schema.Literal("extension"), reqId: Id, op: ExtensionOp }),
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
	Schema.Struct({ t: Schema.Literal("home_refused"), op: FileOp, reason: Schema.String }),
	Schema.Struct({ t: Schema.Literal("chat_refused"), roomId: RoomId, existing: RoomId }),
	Schema.Struct({ t: Schema.Literal("typing"), roomId: RoomId, names: Schema.Array(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("reset"), snapshot: UserSnapshot }),
	Schema.Struct({ t: Schema.Literal("memory_result"), reqId: Id, result: MemoryResult }),
	Schema.Struct({ t: Schema.Literal("search"), query: Schema.String, chats: Schema.Array(Chat) }),
	Schema.Struct({ t: Schema.Literal("composio"), reqId: Schema.optionalKey(Id), result: ComposioResult }),
	Schema.Struct({ t: Schema.Literal("kernel"), reqId: Schema.optionalKey(Id), result: KernelResult }),
	Schema.Struct({ t: Schema.Literal("browserState"), state: BrowserState }),
	Schema.Struct({ t: Schema.Literal("browserLink"), reqId: Id, result: BrowserLinkResult }),
	Schema.Struct({ t: Schema.Literal("login.notify"), loginId: Id, event: LoginEvent }),
	Schema.Struct({ t: Schema.Literal("login.prompt"), loginId: Id, promptId: Id, prompt: LoginPrompt }),
	Schema.Struct({
		t: Schema.Literal("login.done"),
		loginId: Id,
		provider: Schema.Struct({ provider: Id, kind: Schema.Literals(["api_key", "oauth"]), last4: Schema.String }),
	}),
	Schema.Struct({ t: Schema.Literal("login.error"), loginId: Id, reason: LoginErrorReason, message: Schema.String }),
	Schema.Struct({ t: Schema.Literal("extension_result"), reqId: Id, result: ExtensionResult }),
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
	| Same<typeof Trigger.Type, P.Trigger>
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
	| Same<typeof ChatLast.Type, P.ChatLast>
	| Same<typeof UserEvent.Type, P.UserEvent>
	| Same<typeof UserSnapshot.Type, P.UserSnapshot>
	| Same<typeof MemoryOp.Type, P.MemoryOp>
	| Same<typeof MemoryResult.Type, P.MemoryResult>
	| Same<typeof ComposioStatus.Type, P.ComposioStatus>
	| Same<typeof ComposioResult.Type, P.ComposioResult>
	| Same<typeof KernelStatus.Type, P.KernelStatus>
	| Same<typeof KernelResult.Type, P.KernelResult>
	| Same<typeof BrowserState.Type, P.BrowserState>
	| Same<typeof BrowserLinkResult.Type, P.BrowserLinkResult>
	| Same<typeof ClientToUser.Type, P.ClientToUser>
	| Same<typeof UserToClient.Type, P.UserToClient>
	| Same<typeof ExtensionInfo.Type, P.ExtensionInfo>
	| Same<typeof ExtensionProposal.Type, P.ExtensionProposal>
	| Same<typeof ExtensionOp.Type, P.ExtensionOp>
	| Same<typeof ExtensionResult.Type, P.ExtensionResult>
>

export * from "./loops"
