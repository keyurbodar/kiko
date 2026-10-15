import type { AgentSlug, RoomId } from "./ids"
import type { ExtensionBundle, ExtensionManifest } from "./manifest"

export * from "./manifest"

export type ExtensionSource = "human" | "agent" | "catalog"

export type ExtensionInfo = {
	name: string
	version: string
	description: string
	hash: string
	enabled: boolean
	agents: readonly AgentSlug[] | null
	source: ExtensionSource
	by?: AgentSlug
	room?: RoomId
	manifest: ExtensionManifest
	secrets: readonly { name: string; set: boolean }[]
	error?: string
	installedAt: number
	updatedAt: number
}

export type ExtensionProposal = {
	id: string
	name: string
	version: string
	hash: string
	source: ExtensionSource
	by?: AgentSlug
	room?: RoomId
	bundle: ExtensionBundle
	replaces?: string
	createdAt: number
}

export type ExtensionCatalogEntry = {
	name: string
	version: string
	description: string
	bundle: ExtensionBundle
}

export type ExtensionOp =
	| { op: "propose"; bundle: unknown; room?: RoomId }
	| { op: "catalog" }
	| { op: "propose_catalog"; name: string }
	| { op: "install"; id: string }
	| { op: "decline"; id: string }
	| { op: "enable"; name: string; enabled: boolean }
	| { op: "agents"; name: string; agents: readonly AgentSlug[] | null }
	| { op: "secret"; name: string; secret: string; value: string | null }
	| { op: "uninstall"; name: string }
	| { op: "source"; name: string }

export type ExtensionResult =
	| {
			ok: true
			proposal?: ExtensionProposal
			extension?: ExtensionInfo
			bundle?: ExtensionBundle
			catalog?: readonly ExtensionCatalogEntry[]
	  }
	| { ok: false; error: string; problems?: readonly string[] }
