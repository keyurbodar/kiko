// Sample frames that the tests and the client's mock room share. Together they
// hold every frame tag, every event tag, and every rich text node.
//
// The room is one human with a lead agent, ada, and a second agent, bob.

import type { Envelope } from "./envelope"
import type { AgentSlug, MessageId, RoomId, UserId } from "./ids"
import type { RichText } from "./rich-text"
import type { Approval, ClientToRoom, FileRef, Member, Message, RoomEvent, RoomSnapshot, RoomToClient, Task } from "./room"
import type { Chat, ClientToUser, UserToClient } from "./user"

export const userId = "user_fixture" as UserId
export const roomId = "01JZ8Q4T6M0000000000000001" as RoomId
export const otherRoomId = "01JZ8Q4T6M0000000000000002" as RoomId
export const ada = "ada" as AgentSlug
export const bob = "bob" as AgentSlug

const messageId = (n: number) => `m${n}` as MessageId
const at = (seq: number) => 1_790_000_000_000 + seq * 1000

export const members: readonly Member[] = [
	{ slug: ada, name: "ada", lead: true },
	{ slug: bob, name: "bob", lead: false },
]

export const file: FileRef = {
	id: "f1",
	name: "plan.png",
	size: 48_211,
	type: "image/png",
	width: 1280,
	height: 720,
	thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
}

/** One of every block and inline node. */
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

export const approval: Approval = {
	id: "a1",
	slug: bob,
	summary: "send an email to the team",
	state: "pending",
	expiresAt: at(9) + 240_000,
}

/** One of every stored event, in `seq` order. */
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
	{ seq: 16, at: at(16), t: "approval", approval },
	{ seq: 17, at: at(17), t: "file", file },
]

/** The room after `roomEvents`. */
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
	approvals: [approval],
	files: [file],
}

export const clientToRoom: readonly ClientToRoom[] = [
	{ t: "hello", lastSeq: 0 },
	{ t: "send", clientId: "c1", text: "can you two plan the protocol package?", files: [file] },
	{ t: "send", clientId: "c2", text: "thanks", replyTo: messageId(2) },
	{ t: "react", messageId: messageId(2), emoji: "🔥" },
	{ t: "react", messageId: messageId(2), emoji: null },
	{ t: "edit", messageId: messageId(1), text: "can you two plan the wire protocol package?" },
	{ t: "delete", messageId: messageId(1) },
	{ t: "read", seq: 9 },
	{ t: "typing" },
	{ t: "stop" },
	{ t: "approve", approvalId: "a1", action: "accept" },
	{ t: "approve", approvalId: "a1", action: "decline" },
	{ t: "task", op: { op: "create", id: "t3", title: "ship it", owner: bob, dependsOn: ["t1"] } },
	{ t: "task", op: { op: "update", id: "t3", status: "review", owner: null, note: "ready" } },
	{ t: "task", op: { op: "delete", id: "t3" } },
	{ t: "search", query: "protocol" },
	{ t: "search", query: "protocol", before: 9, limit: 20 },
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
	{ t: "search", query: "protocol", results: [{ id: messageId(1), seq: 1, snippet: "plan the protocol package" }], next: null },
	{ t: "search", query: "plan", before: 9, results: [], next: null },
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
}

export const clientToUser: readonly ClientToUser[] = [
	{ t: "hello", lastSeq: 0 },
	{ t: "chat", op: { op: "create", roomId, title: "protocol plan" } },
	{ t: "chat", op: { op: "rename", roomId, title: "wire protocol plan" } },
	{ t: "chat", op: { op: "pin", roomId, pinned: true } },
	{ t: "chat", op: { op: "mute", roomId, muted: true } },
	{ t: "chat", op: { op: "delete", roomId: otherRoomId } },
	{ t: "search", query: "protocol" },
]

export const userToClient: readonly UserToClient[] = [
	{
		t: "events",
		events: [
			{ seq: 1, at: at(1), t: "chat", chat },
			{ seq: 2, at: at(2), t: "chat_removed", roomId: otherRoomId },
		],
	},
	{ t: "reset", snapshot: { seq: 2, chats: [chat] } },
	{ t: "search", query: "protocol", chats: [chat] },
]

/** One envelope from each kind of sender. */
export const envelopes: readonly Envelope[] = [
	{
		id: "d1",
		roomId,
		from: { kind: "human" },
		body: "can you two plan the protocol package?",
		hop: 0,
		rootId: "m1",
		tainted: false,
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
		tainted: true,
		seq: 2,
	},
	{
		id: "unblocked:t2",
		roomId,
		from: { kind: "system", reason: "task_unblocked" },
		body: "task t2 is unblocked",
		hop: 0,
		rootId: "unblocked:t2",
		tainted: false,
		seq: 18,
	},
]
