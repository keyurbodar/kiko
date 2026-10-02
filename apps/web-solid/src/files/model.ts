// The file tree's pure parts: the path index, sorting, hidden files, and the
// per-room expanded set. No Solid and no DOM, so a table of cases covers them.

/** The root's id. Every other node's id is its full path, with no leading slash. */
export const ROOT = ""

export type TreeIndex = {
	/** Child ids by parent id, folders first and then files, each by name. */
	children: Map<string, string[]>
	folders: Set<string>
}

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)
export const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ROOT)
export const join = (dir: string, name: string) => (dir === ROOT ? name : `${dir}/${name}`)

/** A dot file, or anything inside a dot folder. */
export const isHidden = (path: string) => path.split("/").some((part) => part.startsWith("."))

const byName = (a: string, b: string) => basename(a).localeCompare(basename(b), undefined, { numeric: true })

/**
 * Builds the tree from the room's file paths. `emptyFolders` are folders the
 * user made that hold no file yet, since the index only knows files.
 */
export function buildIndex(paths: Iterable<string>, emptyFolders: Iterable<string> = []): TreeIndex {
	const folders = new Set<string>()
	const files = new Set<string>()
	const addFolders = (path: string) => {
		for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) folders.add(dir)
	}
	for (const raw of paths) {
		const path = raw.replace(/^\/+/, "")
		if (!path) continue
		files.add(path)
		addFolders(path)
	}
	for (const raw of emptyFolders) {
		const path = raw.replace(/^\/+|\/+$/g, "")
		if (!path) continue
		folders.add(path)
		addFolders(path)
	}
	// A path that is both a file and a folder prefix shows as the folder.
	for (const dir of folders) files.delete(dir)
	const children = new Map<string, string[]>([[ROOT, []]])
	for (const dir of folders) children.set(dir, [])
	for (const id of [...folders, ...files]) children.get(dirname(id))!.push(id)
	for (const list of children.values()) {
		list.sort((a, b) => {
			const fa = folders.has(a)
			const fb = folders.has(b)
			return fa === fb ? byName(a, b) : fa ? -1 : 1
		})
	}
	return { children, folders }
}

/** Every file path at or under `path`, for a delete or a rename of a folder. */
export function pathsUnder(paths: Iterable<string>, path: string): string[] {
	return [...paths].filter((p) => p === path || p.startsWith(`${path}/`))
}

// The expanded set, one per room.

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">

const expandedKey = (roomId: string) => `kiko:files:expanded:${roomId}`

export function loadExpanded(roomId: string, store: KeyValueStore | undefined): string[] {
	try {
		const parsed: unknown = JSON.parse(store?.getItem(expandedKey(roomId)) ?? "[]")
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
	} catch {
		return []
	}
}

export function saveExpanded(roomId: string, store: KeyValueStore | undefined, expanded: readonly string[]) {
	try {
		store?.setItem(expandedKey(roomId), JSON.stringify(expanded))
	} catch {
		// Private windows and full quotas throw. The tree works without it.
	}
}

/** The tree virtualizes past this many visible rows. */
export const VIRTUALIZE_AFTER = 500
