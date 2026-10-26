import { PREVIEW_DATABASE } from "../../lib/storage"
import type { Preview } from "./model"

const STORE = "previews"
const KEEP = 400
const PRUNE_AT = 500

type Row = { key: string; at: number; preview: Preview }

const memory = new Map<string, Preview>()
let opened: Promise<IDBDatabase | null> | undefined

function prune(db: IDBDatabase) {
  const tx = db.transaction(STORE, "readwrite")
  const store = tx.objectStore(STORE)
  const count = store.count()
  count.addEventListener("success", () => {
    let extra = count.result - KEEP
    if (count.result < PRUNE_AT) return
    const cursor = store.index("at").openKeyCursor()
    cursor.addEventListener("success", () => {
      const row = cursor.result
      if (!row || extra-- <= 0) return
      store.delete(row.primaryKey)
      row.continue()
    })
  })
}

function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null)
    const request = indexedDB.open(PREVIEW_DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("at", "at")
    }
    request.onsuccess = () => {
      const db = request.result
      db.addEventListener("versionchange", () => {
        db.close()
        opened = undefined
      })
      prune(db)
      resolve(db)
    }
    request.addEventListener("error", () => resolve(null))
  })
  return opened
}

export const memoryPreview = (key: string): Preview | undefined => memory.get(key)

export async function storedPreview(key: string): Promise<Preview | undefined> {
  const db = await open()
  if (!db) return undefined
  const row = await new Promise<Row | undefined>((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key)
    request.addEventListener("success", () => resolve(request.result as Row | undefined))
    request.addEventListener("error", () => resolve(undefined))
  }).catch(() => undefined)
  if (row) memory.set(key, row.preview)
  return row?.preview
}

export function keepPreview(key: string, preview: Preview) {
  memory.set(key, preview)
  void open().then((db) => {
    if (!db) return
    try {
      db.transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put({ key, at: Date.now(), preview } satisfies Row)
    } catch {}
  })
}
