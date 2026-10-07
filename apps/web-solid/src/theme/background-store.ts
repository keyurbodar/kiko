// The chat background's sharp picture, kept on this device in IndexedDB, as monocode keeps its
// copy in the app's data folder. One picture at a time; choosing another replaces it.

const DB = "kiko:background"
const STORE = "pictures"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
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

export async function savePicture(id: string, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(blob, id))
}

/** The picture, or null when this device does not have it (a cleared browser). */
export async function loadPicture(id: string): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    return ((await run("readonly", (s) => s.get(id))) as Blob | undefined) ?? null
  } catch {
    return null
  }
}

export async function removePicture(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  await run("readwrite", (s) => s.delete(id))
}
