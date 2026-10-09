// The warm tier. Architecture section 19.2.
//
// Raw IndexedDB behind a small promise wrapper, with an in-memory twin. Writes
// are queued and flushed together in one transaction when the browser is idle,
// at most once every 500 ms. Reads flush the queue first, so a read always sees
// every earlier write. When IndexedDB is missing, blocked, or fails, the tier
// switches to memory for the rest of the session and keeps working.
//
// ASSUMPTION: the database version is the schema version. Any mismatch, up or
// down, drops every store and starts empty. The server refills it. So a single
// version on the database stands for the version on each value.

export const SCHEMA_VERSION = 3

export const STORES = ["chats", "messages", "outbox", "drafts", "meta"] as const
export type StoreName = (typeof STORES)[number]

export type WarmKey = string | number | readonly (string | number)[]

/** Both ends included. */
export type KeyRange = { lower: WarmKey; upper: WarmKey }

export type WarmOptions = {
	/** Each user has a database of their own, so signing out can drop it whole. */
	userId: string
	version?: number
	/** Defaults to `globalThis.indexedDB`. Pass null to force memory. */
	idb?: IDBFactory | null
	/** Least time between two flushes. Defaults to 500 ms. */
	flushEveryMs?: number
	/**
	 * How long an open may take before the tier gives up on it. Defaults to 10 s: a busy disk can
	 * take seconds, and giving up costs the session its persistence.
	 */
	openTimeoutMs?: number
}

export type Warm = {
	/** `memory` once IndexedDB is missing, blocked, or has failed. */
	readonly mode: "idb" | "memory"
	get<T>(store: StoreName, key: WarmKey): Promise<T | undefined>
	/** In key order. */
	getAll<T>(store: StoreName, range?: KeyRange): Promise<T[]>
	/** Up to `limit` values from the top of the range, newest key first. */
	newest<T>(store: StoreName, range: KeyRange, limit: number): Promise<T[]>
	put(store: StoreName, key: WarmKey, value: unknown): void
	delete(store: StoreName, key: WarmKey): void
	deleteRange(store: StoreName, range: KeyRange): void
	clear(store: StoreName): void
	/** Writes the queue now. Resolves when it is stored. */
	flush(): Promise<void>
	close(): void
}

export const warmName = (userId: string) => `kiko:warm:${userId}`

type Op =
	| { op: "put"; store: StoreName; key: WarmKey; value: unknown }
	| { op: "delete"; store: StoreName; key: WarmKey }
	| { op: "deleteRange"; store: StoreName; range: KeyRange }
	| { op: "clear"; store: StoreName }

type Backend = {
	mode: "idb" | "memory"
	get(store: StoreName, key: WarmKey): Promise<unknown>
	getAll(store: StoreName, range?: KeyRange): Promise<unknown[]>
	newest(store: StoreName, range: KeyRange, limit: number): Promise<unknown[]>
	apply(ops: readonly Op[]): Promise<void>
	close(): void
}

// The promise wrapper.

const request = <T>(r: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		r.onsuccess = () => resolve(r.result)
		r.onerror = () => reject(r.error)
	})

const idbRange = (range: KeyRange) => IDBKeyRange.bound(range.lower, range.upper)

function idbBackend(db: IDBDatabase, onLost: () => void): Backend {
	db.onversionchange = () => {
		// Another tab is upgrading. Step aside so it is not blocked.
		db.close()
		onLost()
	}
	db.onclose = onLost
	const read = (store: StoreName) => db.transaction(store, "readonly").objectStore(store)
	return {
		mode: "idb",
		get: (store, key) => request(read(store).get(key as IDBValidKey)),
		getAll: (store, range) => request(read(store).getAll(range ? idbRange(range) : undefined)),
		newest: (store, range, limit) =>
			new Promise((resolve, reject) => {
				const out: unknown[] = []
				if (limit <= 0) return resolve(out)
				const r = read(store).openCursor(idbRange(range), "prev")
				r.onerror = () => reject(r.error)
				r.onsuccess = () => {
					const cursor = r.result
					if (!cursor) return resolve(out)
					out.push(cursor.value)
					if (out.length >= limit) return resolve(out)
					cursor.continue()
				}
			}),
		apply: (ops) =>
			new Promise((resolve, reject) => {
				const names = [...new Set(ops.map((o) => o.store))]
				const tx = db.transaction(names, "readwrite")
				tx.oncomplete = () => resolve()
				tx.onerror = () => reject(tx.error)
				tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"))
				for (const o of ops) {
					const s = tx.objectStore(o.store)
					if (o.op === "put") s.put(o.value, o.key as IDBValidKey)
					else if (o.op === "delete") s.delete(o.key as IDBValidKey)
					else if (o.op === "deleteRange") s.delete(idbRange(o.range))
					else s.clear()
				}
			}),
		close: () => db.close(),
	}
}

/** IndexedDB key order: numbers, then strings, then arrays compared item by item. */
export function compareKeys(a: WarmKey, b: WarmKey): number {
	const rank = (k: WarmKey) => (typeof k === "number" ? 0 : typeof k === "string" ? 1 : 2)
	const ra = rank(a)
	const rb = rank(b)
	if (ra !== rb) return ra - rb
	if (Array.isArray(a) && Array.isArray(b)) {
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			const c = compareKeys(a[i], b[i])
			if (c !== 0) return c
		}
		return a.length - b.length
	}
	return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The most rows each store keeps in the memory twin. It stands in for a disk the browser refused,
 * so it holds a working set, not a history: past this the oldest-written rows go.
 */
export const MEMORY_ROWS_PER_STORE = 2000

function memoryBackend(): Backend {
	const stores = new Map<StoreName, Map<string, { key: WarmKey; value: unknown }>>(STORES.map((s) => [s, new Map()]))
	const table = (store: StoreName) => stores.get(store) as Map<string, { key: WarmKey; value: unknown }>
	const inRange = (k: WarmKey, r: KeyRange) => compareKeys(k, r.lower) >= 0 && compareKeys(k, r.upper) <= 0
	const sorted = (store: StoreName, range?: KeyRange) =>
		[...table(store).values()].filter((e) => !range || inRange(e.key, range)).sort((a, b) => compareKeys(a.key, b.key))
	return {
		mode: "memory",
		get: async (store, key) => table(store).get(JSON.stringify(key))?.value,
		getAll: async (store, range) => sorted(store, range).map((e) => e.value),
		newest: async (store, range, limit) =>
			sorted(store, range)
				.reverse()
				.slice(0, Math.max(0, limit))
				.map((e) => e.value),
		apply: async (ops) => {
			for (const o of ops) {
				const t = table(o.store)
				// Clone, so memory behaves like IndexedDB when the caller later mutates the value.
				if (o.op === "put") {
					const k = JSON.stringify(o.key)
					// Delete first, so a rewrite counts as the newest write.
					t.delete(k)
					t.set(k, { key: o.key, value: structuredClone(o.value) })
					if (t.size > MEMORY_ROWS_PER_STORE) t.delete(t.keys().next().value as string)
				}
				else if (o.op === "delete") t.delete(JSON.stringify(o.key))
				else if (o.op === "deleteRange") {
					for (const [k, e] of t) if (inRange(e.key, o.range)) t.delete(k)
				} else t.clear()
			}
		},
		close: () => {},
	}
}

function upgrade(db: IDBDatabase, tx: IDBTransaction, version: number) {
	for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name)
	for (const name of STORES) db.createObjectStore(name)
	tx.objectStore("meta").put(version, "schema")
}

/** Resolves to null when IndexedDB is missing, blocked, too slow, or fails. */
function openIdb(idb: IDBFactory, name: string, version: number, timeoutMs: number): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		let done = false
		const finish = (db: IDBDatabase | null) => {
			if (done) {
				// A late success after we gave up. Do not hold the connection.
				db?.close()
				return
			}
			done = true
			clearTimeout(timer)
			resolve(db)
		}
		const timer = setTimeout(() => finish(null), timeoutMs)
		let r: IDBOpenDBRequest
		try {
			r = idb.open(name, version)
		} catch {
			return finish(null)
		}
		r.onupgradeneeded = () => upgrade(r.result, r.transaction as IDBTransaction, version)
		r.onsuccess = () => finish(r.result)
		r.onerror = (event) => {
			event.preventDefault()
			if (r.error?.name !== "VersionError" || done) return finish(null)
			// The stored database is newer than this code. Drop it and start again.
			const del = idb.deleteDatabase(name)
			del.onsuccess = () => {
				const again = idb.open(name, version)
				again.onupgradeneeded = () => upgrade(again.result, again.transaction as IDBTransaction, version)
				again.onsuccess = () => finish(again.result)
				again.onerror = () => finish(null)
			}
			del.onerror = () => finish(null)
		}
		r.onblocked = () => finish(null)
	})
}

const idle = (cb: () => void, timeout: number) => {
	const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number })
		.requestIdleCallback
	if (ric) ric(cb, { timeout })
	else setTimeout(cb, 0)
}

export async function openWarm(options: WarmOptions): Promise<Warm> {
	const version = options.version ?? SCHEMA_VERSION
	const every = options.flushEveryMs ?? 500
	const idb = options.idb === undefined ? (globalThis.indexedDB ?? null) : options.idb

	let backend: Backend = memoryBackend()
	const toMemory = () => {
		if (backend.mode === "memory") return
		backend.close()
		backend = memoryBackend()
	}
	if (idb && typeof IDBKeyRange !== "undefined") {
		const db = await openIdb(idb, warmName(options.userId), version, options.openTimeoutMs ?? 10_000)
		if (db) backend = idbBackend(db, toMemory)
	}

	let queue: Op[] = []
	let scheduled: ReturnType<typeof setTimeout> | undefined
	let tail: Promise<void> = Promise.resolve()

	/** Runs on IndexedDB and moves to memory on any failure, retrying there once. */
	async function guard<T>(run: (b: Backend) => Promise<T>): Promise<T> {
		const b = backend
		try {
			return await run(b)
		} catch (error) {
			if (b.mode === "memory") throw error
			if (backend === b) toMemory()
			return run(backend)
		}
	}

	function flush(): Promise<void> {
		if (scheduled !== undefined) clearTimeout(scheduled)
		scheduled = undefined
		if (queue.length === 0) return tail
		const ops = queue
		queue = []
		// Starting the transaction now, before any read's transaction, keeps reads after writes.
		const run = guard((b) => b.apply(ops))
		tail = run.catch(() => {})
		return tail
	}

	function enqueue(op: Op) {
		queue.push(op)
		if (scheduled !== undefined) return
		// The first write opens a window. Everything written inside it goes in one flush.
		scheduled = setTimeout(() => idle(() => void flush(), every), every)
	}

	const read = <T>(run: (b: Backend) => Promise<unknown>) => {
		if (queue.length > 0) void flush()
		return guard(run) as Promise<T>
	}

	const onHide = () => void flush()
	const onVisibility = () => {
		if (globalThis.document?.visibilityState === "hidden") void flush()
	}
	globalThis.addEventListener?.("pagehide", onHide)
	globalThis.document?.addEventListener?.("visibilitychange", onVisibility)

	return {
		get mode() {
			return backend.mode
		},
		get: (store, key) => read((b) => b.get(store, key)),
		getAll: (store, range) => read((b) => b.getAll(store, range)),
		newest: (store, range, limit) => read((b) => b.newest(store, range, limit)),
		put: (store, key, value) => enqueue({ op: "put", store, key, value }),
		delete: (store, key) => enqueue({ op: "delete", store, key }),
		deleteRange: (store, range) => enqueue({ op: "deleteRange", store, range }),
		clear: (store) => enqueue({ op: "clear", store }),
		flush,
		close: () => {
			void flush().then(() => backend.close())
			globalThis.removeEventListener?.("pagehide", onHide)
			globalThis.document?.removeEventListener?.("visibilitychange", onVisibility)
		},
	}
}

/** Drops a user's warm tier, for sign-out. Close their `Warm` first. */
export function deleteWarm(userId: string, idb: IDBFactory | null = globalThis.indexedDB ?? null): Promise<void> {
	if (!idb) return Promise.resolve()
	return new Promise((resolve) => {
		try {
			const r = idb.deleteDatabase(warmName(userId))
			r.onsuccess = () => resolve()
			r.onerror = () => resolve()
			r.onblocked = () => resolve()
		} catch {
			resolve()
		}
	})
}
