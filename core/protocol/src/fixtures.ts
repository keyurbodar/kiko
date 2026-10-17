
import type { AgentSlug, MessageId, RoomId, UserId } from "./ids"
import type { RichText } from "./rich-text"
import type { Activity, AgentStatus, FileRef, HumanAsk, Member, Message, RoomEvent, RoomSnapshot, SystemEvent, Task, WorkerRow } from "./room"
import type { Chat } from "./user"

export const userId = "user_fixture" as UserId
export const roomId = "01JZ8Q4T6M0000000000000001" as RoomId
export const otherRoomId = "01JZ8Q4T6M0000000000000002" as RoomId
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

export const worker: WorkerRow = { id: "w1", task: "find the three pricing pages", status: "running", step: "web_fetch", steps: 2, startedAt: at(20) }

export const activities: readonly Activity[] = [
	{ kind: "writing" },
	{ kind: "tool", tool: "edit", caption: "editing /plan.md" },
	{ kind: "tool", tool: "run", caption: "running bun test" },
	{ kind: "waiting", on: bob },
	{ kind: "failed", caption: "failed: reading /plan.md (no such file)" },
	{ kind: "background", workers: [worker] },
	{ kind: "background", workers: [] },
]

export const agentStatuses: readonly AgentStatus[] = [
	{ slug: ada, state: "typing", doing: "editing /plan.md", activity: { kind: "tool", tool: "edit", caption: "editing /plan.md" } },
	{ slug: bob, state: "working", activity: { kind: "background", workers: [worker] } },
]

export const systemEvents: readonly SystemEvent[] = [
	{ kind: "delegated", from: ada, to: bob, title: "write the tests" },
	{ kind: "routine", title: "morning summary" },
	{ kind: "agent_message", from: ada, to: bob },
	{ kind: "activity", count: 4 },
	{ kind: "routine_created", agent: ada, title: "morning summary", private: true },
	{ kind: "model_changed", agent: ada, model: "Claude Opus 4.6", private: true },
	{ kind: "compacted", agent: ada, private: true },
	{ kind: "group_formed", private: true },
	{ kind: "member_added", slug: bob, name: "Bob", private: true },
	{ kind: "member_removed", slug: bob, name: "Bob", private: true },
	{ kind: "browser_control", agent: ada, reason: "please sign in to mail.google.com", private: true },
	{ kind: "created", roomId, title: "Sunny morning" },
	{ kind: "worker", agent: ada, state: "started", title: "write the tests", private: true },
	{ kind: "run_stopped", agent: ada, private: true },
]

const humanAsk: HumanAsk = { id: "ask1", from: ada, text: "which database should we use?", options: ["sqlite", "postgres"], messageId: messageId(4) }

const openQuestion: HumanAsk = { id: "ask2", from: bob, text: "what should the project be called?", messageId: messageId(5) }

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
	{ seq: 18, at: at(18), t: "message", id: messageId(6), from: { kind: "system", reason: "divider" }, text: "ada compacted its context", event: systemEvents[6]! },
	{ seq: 19, at: at(19), t: "message", id: messageId(7), from: { kind: "system", reason: "files" }, text: "ada handed bob a task: write the tests", event: systemEvents[0]! },
	{ seq: 20, at: at(20), t: "ask", ...humanAsk },
	{ seq: 21, at: at(21), t: "ask", ...openQuestion },
	{ seq: 22, at: at(22), t: "ask_resolved", id: "ask1", how: "answered" },
	{ seq: 23, at: at(23), t: "ask_resolved", id: "ask2", how: "skipped" },
]

export const roomSnapshot: RoomSnapshot = {
	seq: 23,
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
		...roomEvents.flatMap((e) => {
			if (e.t !== "message" || !e.event) return []
			const { t: _, ...message } = e
			return [message]
		}),
	],
	tasks: [task],
	files: [file],
	folders: [],
	agents: agentStatuses,
	asks: [],
}

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
