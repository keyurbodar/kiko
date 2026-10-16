
import type { ChatLast } from "./activity"
import type { AgentSlug, RoomId } from "./ids"
import type { MemoryOp, MemoryResult } from "./memory"
import type { FileOp, FileRef } from "./room"

export type Chat = {
	roomId: RoomId
	title: string
	pinned: boolean
	muted: boolean
	lastSeq: number
	lastPreview: string
	unread: number
	updatedAt: number
	agents?: readonly string[]
	kiko?: true
	private?: boolean
	last?: ChatLast
	mentions?: number
	group?: true
}

export type Agent = {
	id: string
	name: string
	slug: AgentSlug
	prompt: string
	model: string
}

export type AgentOp = { op: "create"; agent: Agent }

export type ChatOp =
	| { op: "create"; roomId: RoomId; title: string; agents?: readonly string[] }
	| { op: "rename"; roomId: RoomId; title: string }
	| { op: "pin"; roomId: RoomId; pinned: boolean }
	| { op: "mute"; roomId: RoomId; muted: boolean }
	| { op: "private"; roomId: RoomId; private: boolean }
	| { op: "delete"; roomId: RoomId }

type Stored = {
	seq: number
	at: number
}

export type UserEvent =
	| (Stored & { t: "chat"; chat: Chat })
	| (Stored & { t: "chat_removed"; roomId: RoomId })
	| (Stored & { t: "agent"; agent: Agent })
	| (Stored & { t: "theme"; theme: string | null })
	| (Stored & { t: "file"; file: FileRef })
	| (Stored & { t: "file_removed"; ids: readonly string[] })
	| (Stored & { t: "folders"; folders: readonly string[] })

export type UserSnapshot = {
	seq: number
	chats: readonly Chat[]
	agents?: readonly Agent[]
	theme?: string | null
	home: { files: readonly FileRef[]; folders: readonly string[] }
	/** The chat the user was last in, so a new device opens there. The kiko chat when that one is gone. */
	lastChat?: RoomId
}

export type ComposioStatus = {
	connected: boolean
	rows: number
}

export type ComposioResult =
	| {
			ok: true
			status: ComposioStatus
			tools?: readonly string[]
			readOnly?: readonly string[]
	  }
	| { ok: false; error: string }

export type KernelStatus = {
	connected: boolean
	broken: boolean
	browser: { mode: "headless" | "headful"; tabs: Readonly<Record<string, number>> } | null
}

export type KernelResult = { ok: true; status: KernelStatus } | { ok: false; error: string }

export type BrowserState = {
	mode: "headless" | "headful"
	tabs: readonly { agent: string; slug: string; host: string }[]
	takeover: boolean
	switching: boolean
	since: number
} | null

export type BrowserLinkResult = { ok: true; url: string } | { ok: false; error: string }

export type ClientToUser =
	| { t: "hello"; lastSeq: number }
	| { t: "chat"; op: ChatOp }
	/** The user is in this chat now. Stored, not broadcast, so the next device opens it (`lastChat`). */
	| { t: "open"; roomId: RoomId }
	| { t: "agent"; op: AgentOp }
	| { t: "memory"; reqId: string; op: MemoryOp }
	| { t: "theme"; theme: string | null }
	| { t: "search"; query: string }
	| { t: "connectComposio"; reqId: string; apiKey: string }
	| { t: "disconnectComposio"; reqId: string }
	| { t: "composioStatus"; reqId: string; tools?: boolean }
	| { t: "connectKernel"; reqId: string; apiKey: string }
	| { t: "disconnectKernel"; reqId: string }
	| { t: "kernelStatus"; reqId: string }
	/** Opens the live view. `control` also sets the takeover flag. A headless browser is switched to headful first. */
	| { t: "browserLink"; reqId: string; mode: "watch" | "control" }
	| { t: "handBack" }
	| { t: "closeBrowser" }
	| { t: "login.start"; loginId: string; provider: string }
	| { t: "login.answer"; loginId: string; promptId: string; value: string }
	| { t: "login.cancel"; loginId: string }
	| { t: "home"; op: FileOp }
	/** Update this backend to this exact release. Only the owner's socket can ask. */
	| { t: "update.start"; version: string }

/** Where an update is. `restarting` is the last frame the old code sends. */
export type UpdateStage = "checking" | "authorizing" | "uploading" | "restarting" | "failed"

export type UserChange = "routines" | "memory" | "loops"

export type UserToClient =
	| { t: "events"; events: readonly UserEvent[]; version?: string; protocol?: number; fileToken?: string }
	| { t: "reset"; snapshot: UserSnapshot; version?: string; protocol?: number; fileToken?: string }
	| { t: "memory_result"; reqId: string; result: MemoryResult }
	| { t: "search"; query: string; chats: readonly Chat[] }
	| { t: "composio"; reqId?: string; result: ComposioResult }
	| { t: "kernel"; reqId?: string; result: KernelResult }
	| { t: "browserState"; state: BrowserState }
	| { t: "browserLink"; reqId: string; result: BrowserLinkResult }
	| { t: "login.notify"; loginId: string; event: LoginEvent }
	| { t: "login.prompt"; loginId: string; promptId: string; prompt: LoginPrompt }
	| { t: "login.done"; loginId: string; provider: { provider: string; kind: "api_key" | "oauth"; last4: string } }
	| { t: "login.error"; loginId: string; reason: LoginErrorReason; message: string }
	| { t: "chat_refused"; roomId: RoomId; existing: RoomId }
	| { t: "home_refused"; op: FileOp; reason: string }
	| { t: "typing"; roomId: RoomId; names: readonly string[] }
	/** A list the user socket does not carry changed: reload it. */
	| { t: "changed"; what: UserChange }
	| { t: "update.state"; stage: UpdateStage; error?: string }

/** What a sign-in flow tells the user. The same shapes as pi-ai's `AuthEvent`. */
export type LoginEvent =
	| { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code"
			userCode: string
			verificationUri: string
			intervalSeconds?: number
			expiresInSeconds?: number
	  }
	| { type: "progress"; message: string }

/** What a sign-in flow asks the user. The same shapes as pi-ai's `AuthPrompt`, without its signal. */
export type LoginPrompt =
	| { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }

export type LoginErrorReason =
	/** The provider has no sign-in flow that kiko runs on Workers. */
	| "unsupported"
	| "disabled"
	| "unknown"
	| "cancelled"
	| "timeout"
	| "failed"
