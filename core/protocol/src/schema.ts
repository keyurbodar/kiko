// Effect schemas for the wire types, for the server and the CLI. The client
// never imports this entry: it trusts frames from its own server.

import * as Schema from "effect/Schema"
import { isAgentSlug, isRoomId } from "./ids"
import type * as P from "./index"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Id = Schema.String.check(Schema.isMinLength(1))
export const KikoError = Schema.Struct({
	code: Schema.Literals([
		"composio_missing",
		"composio_rejected",
		"composio_down",
		"kernel_missing",
		"kernel_rejected",
		"kernel_down",
		"storage",
		"model",
	]),
	message: Id,
	action: Schema.optionalKey(Schema.Literals(["open_models", "open_integrations"])),
})

const opaque = <T extends string>() => Id.pipe(Schema.refine((value): value is T => true))

export const UserId = opaque<P.UserId>()
export const RoomId = Schema.String.pipe(Schema.refine(isRoomId))
export const MessageId = opaque<P.MessageId>()
export const AgentSlug = Schema.String.pipe(Schema.refine(isAgentSlug))


export const SystemReason = Schema.Literals(["task_updated", "task_unblocked", "reminder", "run_budget", "limit", "files", "created", "routine", "stalled", "initiative", "divider", "system"])

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
	// `loose` is absent on trees stored before the flag, and an absent flag reads as a tight list.
	Schema.Struct({ t: Schema.Literal("list"), start: Schema.optionalKey(Count), loose: Schema.optionalKey(Schema.Boolean), items: Schema.Array(blocks) }),
	Schema.Struct({ t: Schema.Literal("quote"), children: blocks }),
	Schema.Struct({ t: Schema.Literal("rule") }),
	Schema.Struct({ t: Schema.Literal("code_block"), lang: Schema.optionalKey(Schema.String), text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("image"), alt: Schema.String, url: Schema.optionalKey(Schema.String), fileId: Schema.optionalKey(Schema.String) }),
	Schema.Struct({
		t: Schema.Literal("table"),
		align: Schema.Array(Schema.NullOr(Schema.Literals(["left", "center", "right"]))),
		head: Schema.Array(inlines),
		rows: Schema.Array(Schema.Array(inlines)),
	}),
])

export const RichText = blocks


export const AgentState = Schema.Literals(["idle", "typing", "working"])

export const ToolKind = Schema.Literals(["read", "edit", "search", "run", "web", "other"])

export const WorkerRow = Schema.Struct({
	id: Id,
	task: Schema.String,
	status: Schema.Literals(["running", "done", "failed", "stopped"]),
	step: Schema.NullOr(Schema.String),
	steps: Count,
	startedAt: Count,
})

export const Activity = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("writing") }),
	Schema.Struct({ kind: Schema.Literal("tool"), tool: ToolKind, caption: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("waiting"), on: AgentSlug }),
	Schema.Struct({ kind: Schema.Literal("failed"), caption: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("background"), workers: Schema.Array(WorkerRow) }),
])

export const AgentStatus = Schema.Struct({
	slug: AgentSlug,
	state: AgentState,
	doing: Schema.optionalKey(Schema.String),
	activity: Schema.optionalKey(Activity),
})

export const RunErrorKind = Schema.Literals(["no_key", "invalid_key", "quota", "rate_limit", "model_not_found", "network", "overloaded", "timeout", "refused", "too_long", "other"])

export const SystemEvent = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("created"), roomId: RoomId, title: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("delegated"), from: AgentSlug, to: AgentSlug, title: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("routine"), title: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("agent_message"), from: AgentSlug, to: AgentSlug }),
	Schema.Struct({ kind: Schema.Literal("activity"), count: Count }),
	Schema.Struct({ kind: Schema.Literal("routine_created"), agent: AgentSlug, title: Schema.String, byAgent: Schema.optionalKey(Schema.Literal(true)), private: Schema.Literal(true) }),
	Schema.Struct({ kind: Schema.Literal("model_changed"), agent: AgentSlug, model: Schema.String, private: Schema.Literal(true) }),
	Schema.Struct({ kind: Schema.Literal("compacted"), agent: AgentSlug, private: Schema.Literal(true) }),
	Schema.Struct({ kind: Schema.Literal("group_formed"), private: Schema.Literal(true) }),
	Schema.Struct({ kind: Schema.Literal("member_added"), slug: AgentSlug, name: Schema.String, private: Schema.Literal(true) }),
	Schema.Struct({ kind: Schema.Literal("member_removed"), slug: AgentSlug, name: Schema.String, private: Schema.Literal(true) }),
	Schema.Struct({ kind: Schema.Literal("run_error"), slug: AgentSlug, reason: RunErrorKind, actions: Schema.Array(Schema.Literals(["retry", "change_model", "open_settings"])), detail: Schema.optionalKey(Schema.String), private: Schema.Literal(true) }),
])

const UnknownSystemEvent = Schema.Struct({ kind: Schema.String })

const HumanQuestion = Schema.Struct({
  id: Id,
  header: Schema.String,
  question: Schema.String,
  options: Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.optionalKey(Schema.String), value: Schema.optionalKey(Schema.String) })),
  multiSelect: Schema.optionalKey(Schema.Boolean),
  allowCustomAnswer: Schema.optionalKey(Schema.Boolean),
})

export const HumanAsk = Schema.Struct({
	id: Id,
	from: AgentSlug,
	text: Schema.String,
	options: Schema.optionalKey(Schema.Array(Schema.String)),
	questions: Schema.optionalKey(Schema.Array(HumanQuestion)),
	messageId: MessageId,
})

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

export const RunStep = Schema.Struct({
	id: Id,
	runId: Id,
	slug: AgentSlug,
	tool: ToolKind,
	label: Schema.String,
	input: Schema.optionalKey(Schema.String),
	status: Schema.Literals(["running", "done", "failed"]),
	startedAt: Count,
	endedAt: Schema.optionalKey(Count),
	output: Schema.optionalKey(Schema.String),
})

export const RunRef = Schema.Struct({ runId: Id, attempt: Count, index: Count })

const stored = { seq: Count, at: Count }

const ReplyPreview = Schema.Struct({ seq: Count, from: Actor, text: Schema.String, gone: Schema.optionalKey(Schema.Literal(true)) })

export const Message = Schema.Struct({
	id: MessageId,
	...stored,
	from: Sender,
	text: Schema.String,
	rich: Schema.optionalKey(RichText),
	replyTo: Schema.optionalKey(MessageId),
	reply: Schema.optionalKey(ReplyPreview),
	files: Schema.optionalKey(Schema.Array(FileRef)),
	run: Schema.optionalKey(RunRef),
	editedAt: Schema.optionalKey(Count),
	reactions: Schema.optionalKey(Schema.Array(Reaction)),
	goto: Schema.optionalKey(RoomId),
	quote: Schema.optionalKey(Schema.String),
	to: Schema.optionalKey(Schema.Union([AgentSlug, Schema.Literal("all")])),
	initiative: Schema.optionalKey(Schema.Struct({ reason: Schema.String })),
	event: Schema.optionalKey(Schema.Union([SystemEvent, UnknownSystemEvent])),
	steps: Schema.optionalKey(Count),
})

export const ThinkingLevel = Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"])

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
	Schema.Struct({ on: Schema.Literal("message"), contains: Schema.optionalKey(Short(200)) }),
	Schema.Struct({ on: Schema.Literal("webhook"), match: Schema.optionalKey(Schema.Array(WebhookMatch).check(Schema.isMaxLength(8))) }),
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
	Schema.Struct({ ...stored, t: Schema.Literal("ask"), ...HumanAsk.fields }),
	Schema.Struct({ ...stored, t: Schema.Literal("ask_resolved"), id: Id, how: Schema.Literals(["answered", "skipped"]) }),
])

export const RoomSnapshot = Schema.Struct({
	seq: Count,
	readSeq: Count,
	members: Schema.Array(Member),
	messages: Schema.Array(Message),
	tasks: Schema.Array(Task),
	files: Schema.Array(FileRef),
	folders: Schema.Array(Schema.String),
	agents: Schema.optionalKey(Schema.Array(AgentStatus)),
	asks: Schema.optionalKey(Schema.Array(HumanAsk)),
	steps: Schema.optionalKey(Schema.Array(RunStep)),
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
	Schema.Struct({ t: Schema.Literal("answer"), id: Id, value: Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String)]))]) }),
	Schema.Struct({ t: Schema.Literal("skip"), id: Id }),
	Schema.Struct({ t: Schema.Literal("retry"), messageId: MessageId }),
	Schema.Struct({ t: Schema.Literal("steps"), runId: Id }),
])

export const RoomToClient = Schema.Union([
	Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(RoomEvent) }),
	Schema.Struct({ t: Schema.Literal("ack"), clientId: Id, id: MessageId, seq: Count }),
	Schema.Struct({ t: Schema.Literal("reset"), snapshot: RoomSnapshot }),
	Schema.Struct({ t: Schema.Literal("typing"), who: Schema.Array(AgentSlug) }),
	Schema.Struct({ t: Schema.Literal("draft"), slug: AgentSlug, runId: Id, index: Count, text: Schema.String }),
	Schema.Struct({ t: Schema.Literal("status"), ...AgentStatus.fields }),
	Schema.Struct({ t: Schema.Literal("step"), step: RunStep }),
	Schema.Struct({ t: Schema.Literal("steps"), runId: Id, steps: Schema.Array(RunStep) }),
	Schema.Struct({
		t: Schema.Literal("member_refused"),
		op: MemberOp,
		reason: Schema.Literals(["limit", "exists", "unknown", "last", "reserved", "chief", "kiko"]),
	}),
	Schema.Struct({ t: Schema.Literal("send_refused"), clientId: Id, reason: Schema.String }),
	Schema.Struct({ t: Schema.Literal("task_refused"), op: TaskOp, reason: Schema.String }),
	Schema.Struct({ t: Schema.Literal("error"), error: KikoError }),
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
	kiko: Schema.optionalKey(Schema.Literal(true)),
	private: Schema.optionalKey(Schema.Boolean),
	last: Schema.optionalKey(ChatLast),
	mentions: Schema.optionalKey(Count),
	group: Schema.optionalKey(Schema.Literal(true)),
})

export const Agent = Schema.Struct({ id: Id, name: Schema.String, slug: AgentSlug, prompt: Schema.String, model: Schema.String })

export const AgentOp = Schema.Struct({ op: Schema.Literal("create"), agent: Agent })

export const ChatOp = Schema.Union([
	Schema.Struct({ op: Schema.Literal("create"), roomId: RoomId, title: Schema.String, agents: Schema.optionalKey(Schema.Array(Schema.String)) }),
	Schema.Struct({ op: Schema.Literal("rename"), roomId: RoomId, title: Schema.String }),
	Schema.Struct({ op: Schema.Literal("pin"), roomId: RoomId, pinned: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("mute"), roomId: RoomId, muted: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("private"), roomId: RoomId, private: Schema.Boolean }),
	Schema.Struct({ op: Schema.Literal("delete"), roomId: RoomId }),
])

export const AgentModel = Schema.Struct({ model: Schema.String, thinking: ThinkingLevel, thinkingLevels: Schema.Array(ThinkingLevel) })

export const UserEvent = Schema.Union([
	Schema.Struct({ ...stored, t: Schema.Literal("chat"), chat: Chat }),
	Schema.Struct({ ...stored, t: Schema.Literal("chat_removed"), roomId: RoomId }),
	Schema.Struct({ ...stored, t: Schema.Literal("agent"), agent: Agent }),
	Schema.Struct({ ...stored, t: Schema.Literal("agent_model"), slug: AgentSlug, ...AgentModel.fields }),
	Schema.Struct({ ...stored, t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
	Schema.Struct({ ...stored, t: Schema.Literal("file"), file: FileRef }),
	Schema.Struct({ ...stored, t: Schema.Literal("file_removed"), ids: Schema.Array(Id) }),
	Schema.Struct({ ...stored, t: Schema.Literal("folders"), folders: Schema.Array(Schema.String) }),
])

export const UserSnapshot = Schema.Struct({
	seq: Count,
	chats: Schema.Array(Chat),
	agents: Schema.optionalKey(Schema.Array(Agent)),
	agentModels: Schema.optionalKey(Schema.Record(Schema.String, AgentModel)),
	theme: Schema.optionalKey(Schema.NullOr(Schema.String)),
	home: Schema.Struct({ files: Schema.Array(FileRef), folders: Schema.Array(Schema.String) }),
	lastChat: Schema.optionalKey(RoomId),
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
	Schema.Struct({ t: Schema.Literal("agent_model"), slug: AgentSlug, ref: Schema.optionalKey(Schema.String), thinking: Schema.optionalKey(ThinkingLevel), roomId: Schema.optionalKey(RoomId) }),
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
	Schema.Struct({
		t: Schema.Literal("update.start"),
		version: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,64}$/)),
	}),
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
	Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(UserEvent), version: Schema.optionalKey(Schema.String), protocol: Schema.optionalKey(Schema.Number), fileToken: Schema.optionalKey(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("error"), error: KikoError, roomId: Schema.optionalKey(RoomId) }),
	Schema.Struct({ t: Schema.Literal("home_refused"), op: FileOp, reason: Schema.String }),
	Schema.Struct({ t: Schema.Literal("chat_refused"), roomId: RoomId, existing: RoomId }),
	Schema.Struct({ t: Schema.Literal("typing"), roomId: RoomId, names: Schema.Array(Schema.String) }),
	Schema.Struct({ t: Schema.Literal("changed"), what: Schema.Literals(["routines", "memory", "loops"]) }),
	Schema.Struct({ t: Schema.Literal("reset"), snapshot: UserSnapshot, version: Schema.optionalKey(Schema.String), protocol: Schema.optionalKey(Schema.Number), fileToken: Schema.optionalKey(Schema.String) }),
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
	Schema.Struct({
		t: Schema.Literal("update.state"),
		stage: Schema.Literals(["checking", "authorizing", "uploading", "restarting", "failed"]),
		error: Schema.optionalKey(Schema.String),
	}),
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
	| Same<typeof RunStep.Type, P.RunStep>
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
>

export * from "./loops"
