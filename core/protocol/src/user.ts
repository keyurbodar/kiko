import type { ChatLast } from "./activity"
import type { KikoError } from "./errors"
import type { AgentSlug, RoomId } from "./ids"
import type { ThinkingLevel } from "./thinking"
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
	pair?: true
}

export type Agent = {
	id: string
	name: string
	slug: AgentSlug
	prompt: string
	model: string
}

export type AgentModel = { model: string; name?: string; thinking: ThinkingLevel; thinkingLevels: readonly ThinkingLevel[] }

export type AgentOp = { op: "create"; agent: Agent } | { op: "delete"; slug: AgentSlug }

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
	| (Stored & { t: "agent_removed"; id: string; slug: AgentSlug })
	| (Stored & { t: "agent_model"; slug: AgentSlug } & AgentModel)
	| (Stored & { t: "theme"; theme: string | null })
	| (Stored & { t: "file"; file: FileRef })
	| (Stored & { t: "file_removed"; ids: readonly string[] })
	| (Stored & { t: "folders"; folders: readonly string[] })

export type UserSnapshot = {
	seq: number
	chats: readonly Chat[]
	agents?: readonly Agent[]
	agentModels?: Readonly<Record<string, AgentModel>>
	theme?: string | null
	home: { files: readonly FileRef[]; folders: readonly string[] }
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
	| { t: "open"; roomId: RoomId }
	| { t: "agent"; op: AgentOp }
	| { t: "agent_model"; slug: AgentSlug; ref?: string; thinking?: ThinkingLevel; roomId?: RoomId }
	| { t: "memory"; reqId: string; op: MemoryOp }
	| { t: "theme"; theme: string | null }
	| { t: "search"; query: string }
	| { t: "connectComposio"; reqId: string; apiKey: string }
	| { t: "disconnectComposio"; reqId: string }
	| { t: "composioStatus"; reqId: string; tools?: boolean }
	| { t: "connectKernel"; reqId: string; apiKey: string }
	| { t: "disconnectKernel"; reqId: string }
	| { t: "kernelStatus"; reqId: string }
	| { t: "browserLink"; reqId: string; mode: "watch" | "control" }
	| { t: "handBack" }
	| { t: "closeBrowser" }
	| { t: "login.start"; loginId: string; provider: string }
	| { t: "login.answer"; loginId: string; promptId: string; value: string }
	| { t: "login.cancel"; loginId: string }
	| { t: "home"; op: FileOp }
	| { t: "update.start"; version: string }

export type UpdateStage = "checking" | "authorizing" | "uploading" | "restarting" | "failed"

export type UserChange = "routines" | "memory" | "models" | "providers"

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
	| { t: "error"; error: KikoError; roomId?: RoomId }
	| { t: "chat_refused"; roomId: RoomId; existing: RoomId }
	| { t: "model_refused"; slug: AgentSlug; message: string }
	| { t: "home_refused"; op: FileOp; reason: string }
	| { t: "typing"; roomId: RoomId; names: readonly string[] }
	| { t: "changed"; what: UserChange }
	| { t: "update.state"; stage: UpdateStage; error?: string }

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

export type LoginPrompt =
	| { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }

export type LoginErrorReason =
	| "unsupported"
	| "disabled"
	| "unknown"
	| "cancelled"
	| "timeout"
	| "failed"

export type UserSettings = {
	initiative: "off" | "chat" | "digest" | "active"
	capture: "auto" | "off"
	timezone?: string
	onboarded?: boolean
}

export type UserSettingsPatch = {
	initiative?: UserSettings["initiative"]
	capture?: UserSettings["capture"]
	timezone?: string
	onboarded?: true
}
