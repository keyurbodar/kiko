// The sharp wallpaper, kept on this device. The look record syncs only a tiny blurred copy (it
// must fit the server's 32 KB), so the sharp picture with its baked haze lives in IndexedDB,
// keyed by a hash of that synced copy. A look whose copy has no match here shows the blurred
// copy, so another device or a cleared browser still looks right, only softer.
//
// One record: picking a new wallpaper replaces it.

const DB = "kiko:wallpaper"
const STORE = "pictures"
const ID = "current"

type Entry = { id: typeof ID; key: string; blob: Blob }

/** FNV-1a over the synced data URL. It names a picture, it does not protect one. */
export function keyOf(wallpaper: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < wallpaper.length; i++) {
    h ^= wallpaper.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function saveSharp(wallpaper: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === "undefined") return
  await run("readwrite", (s) => s.put({ id: ID, key: keyOf(wallpaper), blob } satisfies Entry))
}

/** The sharp picture for this synced copy, or null when this device does not have it. */
export async function loadSharp(wallpaper: string): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    const entry = (await run("readonly", (s) => s.get(ID))) as Entry | undefined
    return entry && entry.key === keyOf(wallpaper) ? entry.blob : null
  } catch {
    return null
  }
}
