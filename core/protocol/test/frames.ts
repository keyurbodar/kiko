import type { Envelope } from "../src/envelope"
import type { AgentSlug, MessageId, RoomId } from "../src/ids"
import type { ClientToRoom, RoomToClient } from "../src/room"
import type { ClientToUser, UserToClient } from "../src/user"
import { ada, bob, chat, file, otherRoomId, roomEvents, roomId, roomSnapshot } from "../src/fixtures"

const tempRoomId = "01a0fa46-9777-7fdf-871e-3c63e992c708" as RoomId
const messageId = (n: number) => `m${n}` as MessageId
const at = (seq: number) => 1_790_000_000_000 + seq * 1000

export const clientToRoom: readonly ClientToRoom[] = [
	{ t: "hello", lastSeq: 0 },
	{ t: "send", clientId: "c1", text: "can you two plan the protocol package?" },
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

export const clientToUser: readonly ClientToUser[] = [
	{ t: "hello", lastSeq: 0 },
	{ t: "chat", op: { op: "create", roomId, title: "protocol plan" } },
	{ t: "chat", op: { op: "rename", roomId, title: "wire protocol plan" } },
	{ t: "chat", op: { op: "pin", roomId, pinned: true } },
	{ t: "chat", op: { op: "mute", roomId, muted: true } },
	{ t: "chat", op: { op: "delete", roomId: otherRoomId } },
	{ t: "chat", op: { op: "create", roomId: tempRoomId, title: "new chat", agents: ["yuki"], temp: true } },
	{ t: "chat", op: { op: "keep", roomId: tempRoomId, title: "kiko, ada", agents: ["yuki", "ada"] } },
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
