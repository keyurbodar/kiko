
import type { Envelope } from "./envelope"
import type { AgentSlug, MessageId, RoomId, UserId } from "./ids"
import type { RichText } from "./rich-text"
import type { ClientToRoom, FileRef, Member, Message, RoomEvent, RoomSnapshot, RoomToClient, Task } from "./room"
import type { Chat, ClientToUser, UserToClient } from "./user"

export const userId = "user_fixture" as UserId
export const roomId = "01JZ8Q4T6M0000000000000001" as RoomId
export const otherRoomId = "01JZ8Q4T6M0000000000000002" as RoomId
const tempRoomId = "01a0fa46-9777-7fdf-871e-3c63e992c708" as RoomId
export const ada = "ada" as AgentSlug
export const bob = "bob" as AgentSlug

const messageId = (n: number) => `m${n}` as MessageId
const at = (seq: number) => 1_790_000_000_000 + seq * 1000

export const members: readonly Member[] = [
	{ slug: ada, name: "ada", lead: true, role: "plans the work", model: "opencode-go/deepseek-v4.1-flash" },
	{ slug: bob, name: "bob", lead: false },
]

export const file: FileRef = {
	id: "f1",
	name: "plan.png",
	size: 48_211,
	type: "image/png",
}

export const richText: RichText = [
	{ t: "heading", level: 2, children: [{ t: "text", text: "the plan" }] },
	{
		t: "paragraph",
		children: [
			{ t: "text", text: "here it is, " },
			{ t: "mention", slug: bob },
			{ t: "text", text: ". " },
			{ t: "bold", children: [{ t: "text", text: "two steps" }, { t: "italic", children: [{ t: "text", text: " only" }] }] },
			{ t: "text", text: ", " },
			{ t: "strike", children: [{ t: "text", text: "three" }] },
			{ t: "text", text: ". run " },
			{ t: "code", text: "bun test" },
			{ t: "text", text: " and read " },
			{ t: "link", href: "https://example.com/docs", children: [{ t: "text", text: "the docs" }] },
		],
	},
	{
		t: "list",
		start: 1,
		items: [
			[{ t: "paragraph", children: [{ t: "text", text: "write the types" }] }],
			[
				{ t: "paragraph", children: [{ t: "text", text: "test them" }] },
				{ t: "list", items: [[{ t: "paragraph", children: [{ t: "text", text: "round trip" }] }]] },
			],
		],
	},
	{ t: "quote", children: [{ t: "paragraph", children: [{ t: "text", text: "prefer deleting to adding" }] }] },
	{ t: "code_block", lang: "ts", text: 'const t = "hello"\n\nexport default t' },
	{ t: "code_block", text: "<b>raw html stays text</b>" },
	{
		t: "table",
		align: ["left", "center", "right", null],
		head: [[{ t: "text", text: "task" }], [{ t: "text", text: "owner" }], [{ t: "text", text: "hours" }], []],
		rows: [[[{ t: "text", text: "types" }], [{ t: "mention", slug: ada }], [{ t: "text", text: "2" }], []]],
	},
]

const humanMessage: Message = {
	id: messageId(1),
	seq: 1,
	at: at(1),
	from: { kind: "human" },
	text: "can you two plan the protocol package?",
	files: [file],
}

const agentMessage: Message = {
	id: messageId(2),
	seq: 2,
	at: at(2),
	from: { kind: "agent", slug: ada },
	text: "## the plan\n\nhere it is, @bob.",
	rich: richText,
	replyTo: messageId(1),
	run: { runId: "run1", attempt: 1, index: 0 },
}

const systemMessage: Message = {
	id: messageId(3),
	seq: 3,
	at: at(3),
	from: { kind: "system", reason: "reminder" },
	text: "reminder: review the plan",
}

export const task: Task = { id: "t1", title: "write the types", status: "doing", owner: ada, dependsOn: [] }
const blockedTask: Task = { id: "t2", title: "test them", status: "blocked", dependsOn: ["t1"], note: "waits on the types" }

export const roomEvents: readonly RoomEvent[] = [
	{ t: "message", clientId: "c1", ...humanMessage },
	{ t: "message", ...agentMessage },
	{ t: "message", ...systemMessage },
	{ seq: 4, at: at(4), t: "react", messageId: messageId(1), by: { kind: "agent", slug: ada }, emoji: "👍" },
	{ seq: 5, at: at(5), t: "react", messageId: messageId(2), by: { kind: "human" }, emoji: "🔥" },
	{ seq: 6, at: at(6), t: "react", messageId: messageId(2), by: { kind: "human" }, emoji: null },
	{ seq: 7, at: at(7), t: "edit", messageId: messageId(1), text: "can you two plan the wire protocol package?" },
	{ seq: 8, at: at(8), t: "edit", messageId: messageId(2), text: "the plan", rich: [{ t: "paragraph", children: [{ t: "text", text: "the plan" }] }] },
	{ seq: 9, at: at(9), t: "delete", messageIds: [messageId(3)] },
	{ seq: 10, at: at(10), t: "read", upTo: 9 },
	{ seq: 11, at: at(11), t: "member", member: { slug: "cy" as AgentSlug, name: "cy", lead: false } },
	{ seq: 12, at: at(12), t: "member_removed", slug: "cy" as AgentSlug },
	{ seq: 13, at: at(13), t: "task", task },
	{ seq: 14, at: at(14), t: "task", task: blockedTask },
	{ seq: 15, at: at(15), t: "task_removed", id: "t2" },
	{ seq: 17, at: at(17), t: "file", file },
]

export const roomSnapshot: RoomSnapshot = {
	seq: 17,
	readSeq: 9,
	members,
	messages: [
		{
			...humanMessage,
			text: "can you two plan the wire protocol package?",
			editedAt: at(7),
			reactions: [{ by: { kind: "agent", slug: ada }, emoji: "👍" }],
		},
		{
			...agentMessage,
			text: "the plan",
			rich: [{ t: "paragraph", children: [{ t: "text", text: "the plan" }] }],
			editedAt: at(8),
		},
	],
	tasks: [task],
	files: [file],
	folders: [],
}

export const clientToRoom: readonly ClientToRoom[] = [
	{ t: "hello", lastSeq: 0 },
	{ t: "send", clientId: "c1", text: "can you two plan the protocol package?", files: [file] },
	{ t: "send", clientId: "c2", text: "thanks", replyTo: messageId(2) },
	{ t: "send", clientId: "c3", text: "", attachments: [{ pendingId: "0199a8f0-0000-7000-8000-000000000001", name: "plan.pdf", type: "application/pdf", size: 2048 }] },
	{ t: "react", messageId: messageId(2), emoji: "🔥" },
	{ t: "react", messageId: messageId(2), emoji: null },
	{ t: "edit", messageId: messageId(1), text: "can you two plan the wire protocol package?" },
	{ t: "delete", messageId: messageId(1) },
	{ t: "read", seq: 9 },
	{ t: "typing" },
	{ t: "stop" },
	{ t: "task", op: { op: "create", id: "t3", title: "ship it", owner: bob, dependsOn: ["t1"] } },
	{ t: "task", op: { op: "update", id: "t3", status: "review", owner: null, note: "ready" } },
	{ t: "task", op: { op: "delete", id: "t3" } },
	{ t: "member", op: { op: "add", slug: "cy" as AgentSlug, name: "cy", role: "reviews code", model: "opencode-go/deepseek-v4.1-flash" } },
	{ t: "member", op: { op: "add", slug: "dee" as AgentSlug, name: "dee" } },
	{ t: "member", op: { op: "rename", slug: "cy" as AgentSlug, name: "cyrus" } },
	{ t: "member", op: { op: "remove", slug: "cy" as AgentSlug } },
	{ t: "search", query: "protocol" },
	{ t: "search", query: "protocol", before: 9, limit: 20 },
	{ t: "history", seq: 9, before: 30, after: 30 },
]

export const roomToClient: readonly RoomToClient[] = [
	{ t: "ack", clientId: "c1", id: messageId(1), seq: 1 },
	{ t: "events", events: roomEvents },
	{ t: "events", events: [] },
	{ t: "reset", snapshot: roomSnapshot },
	{ t: "typing", who: [ada, bob] },
	{ t: "typing", who: [] },
	{ t: "status", slug: ada, state: "working" },
	{ t: "draft", slug: ada, runId: "run1", index: 1, text: "a long block that is still gro" },
	{ t: "status", slug: ada, state: "idle" },
	{ t: "member_refused", op: { op: "add", slug: "cy" as AgentSlug, name: "cy" }, reason: "limit" },
	{ t: "send_refused", clientId: "c3", reason: "Attachment 'plan.pdf' cannot be sent: attachment not found (removed or expired)." },
	{ t: "search", query: "protocol", results: [{ id: messageId(1), seq: 1, at: 1, from: { kind: "human" }, snippet: "plan the \u0002protocol\u0003 package" }], next: null },
	{ t: "search", query: "plan", before: 9, results: [], next: null },
	{ t: "history", seq: 1, before: 30, after: 30, messages: roomSnapshot.messages },
	{ t: "history", seq: 9, before: 50, after: 0, messages: [] },
]

export const chat: Chat = {
	roomId,
	title: "protocol plan",
	pinned: true,
	muted: false,
	lastSeq: 17,
	lastPreview: "the plan",
	unread: 0,
	updatedAt: at(17),
	agents: ["ada", "bob"],
}

export const clientToUser: readonly ClientToUser[] = [
	{ t: "hello", lastSeq: 0 },
	{ t: "chat", op: { op: "create", roomId, title: "protocol plan" } },
	{ t: "chat", op: { op: "rename", roomId, title: "wire protocol plan" } },
	{ t: "chat", op: { op: "pin", roomId, pinned: true } },
	{ t: "chat", op: { op: "mute", roomId, muted: true } },
	{ t: "chat", op: { op: "delete", roomId: otherRoomId } },
	{ t: "chat", op: { op: "create", roomId: tempRoomId, title: "new chat", agents: ["yuki"], temp: true } },
	{ t: "chat", op: { op: "keep", roomId: tempRoomId, title: "yuki, ada", agents: ["yuki", "ada"] } },
	{ t: "open", roomId: tempRoomId },
	{ t: "search", query: "protocol" },
	{ t: "login.start", loginId: "l1", provider: "github-copilot" },
	{ t: "login.answer", loginId: "l1", promptId: "p1", value: "" },
	{ t: "login.cancel", loginId: "l1" },
]

export const userToClient: readonly UserToClient[] = [
	{
		t: "events",
		events: [
			{ seq: 1, at: at(1), t: "chat", chat },
			{ seq: 2, at: at(2), t: "chat_removed", roomId: otherRoomId },
		],
	},
	{ t: "reset", snapshot: { seq: 2, chats: [chat], home: { files: [file], folders: ["notes"] }, lastChat: roomId } },
	{ t: "chat_refused", roomId: tempRoomId, existing: roomId },
	{ t: "home_refused", op: { op: "rm", paths: ["notes"] }, reason: "notes is a folder with things in it" },
	{ t: "search", query: "protocol", chats: [chat] },
	{ t: "login.prompt", loginId: "l1", promptId: "p1", prompt: { type: "text", message: "enterprise domain", placeholder: "company.ghe.com" } },
	{ t: "login.notify", loginId: "l1", event: { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", intervalSeconds: 5 } },
	{ t: "login.done", loginId: "l1", provider: { provider: "github-copilot", kind: "oauth", last4: "" } },
	{ t: "login.error", loginId: "l2", reason: "timeout", message: "sign-in timed out" },
]

export const envelopes: readonly Envelope[] = [
	{
		id: "d1",
		roomId,
		from: { kind: "human" },
		body: "can you two plan the protocol package?",
		hop: 0,
		rootId: "m1",
		seq: 1,
	},
	{
		id: "d2",
		roomId,
		from: { kind: "agent", slug: ada },
		body: "bob, take the tests",
		replyTo: messageId(1),
		hop: 1,
		rootId: "m1",
		seq: 2,
	},
	{
		id: "unblocked:t2",
		roomId,
		from: { kind: "system", reason: "task_unblocked" },
		body: "task t2 is unblocked",
		hop: 0,
		rootId: "unblocked:t2",
		seq: 18,
	},
]
