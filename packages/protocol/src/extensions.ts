import type { AgentSlug, RoomId } from "./ids"
import type { ExtensionBundle, ExtensionManifest } from "@kiko/sandbox/manifest"

export * from "@kiko/sandbox/manifest"

/** Who made an extension or asked for its install. */
export type ExtensionSource = "human" | "agent" | "catalog"

/** An installed extension as the client sees it. Code travels only on request. */
export type ExtensionInfo = {
	name: string
	version: string
	description: string
	/** The sha-256 of the bundle, hex. */
	hash: string
	enabled: boolean
	/** The agents it is on for, by slug. Null means every agent. */
	agents: readonly AgentSlug[] | null
	source: ExtensionSource
	/** The agent that wrote it, when an agent did. */
	by?: AgentSlug
	/** Where its triggers post. */
	room?: RoomId
	manifest: ExtensionManifest
	/** Each declared secret and whether the user has set it. Never the value. */
	secrets: readonly { name: string; set: boolean }[]
	/** The last error an agent hit loading or running it, if any. */
	error?: string
	installedAt: number
	updatedAt: number
}

/** An install that waits for the human: from an agent, from the catalog, or from a file the human opened. */
export type ExtensionProposal = {
	id: string
	name: string
	version: string
	hash: string
	source: ExtensionSource
	by?: AgentSlug
	room?: RoomId
	bundle: ExtensionBundle
	/** The hash of the installed version this replaces, if any. */
	replaces?: string
	/** The agent wrote it in a run that had read outside content (section 16): review it with care. */
	tainted?: true
	createdAt: number
}

/** A catalog entry, reviewed upstream and shipped with the server. */
export type ExtensionCatalogEntry = {
	name: string
	version: string
	description: string
	bundle: ExtensionBundle
}

export type ExtensionOp =
	/** The human asks to install what they wrote or opened. `bundle` is checked by the server. */
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
			/** After `propose` or `propose_catalog`. */
			proposal?: ExtensionProposal
			/** After `install`, `enable`, `agents`, `secret`. */
			extension?: ExtensionInfo
			/** After `source`. */
			bundle?: ExtensionBundle
			/** After `catalog`. */
			catalog?: readonly ExtensionCatalogEntry[]
	  }
	| { ok: false; error: string; problems?: readonly string[] }
