import { COMPOSER_DATABASE } from "../../lib/storage"

const STORE = "files"

export type DraftFile = {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
}

type Row = DraftFile & { key: string; draftKey: string }

let opened: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(COMPOSER_DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("draftKey", "draftKey")
    }
    request.onsuccess = () => {
      const db = request.result
      db.addEventListener("versionchange", () => {
        db.close()
        opened = undefined
      })
      resolve(db)
    }
    request.addEventListener("error", () => reject(request.error))
  })
  return opened
}

export function forgetDraftFileDb() {
  const pending = opened
  opened = undefined
  void pending?.then((db) => db.close())
}

async function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = body(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request ? request.result : undefined)
    tx.addEventListener("error", () => reject(tx.error))
    tx.addEventListener("abort", () => reject(tx.error))
  })
}

const keyOf = (draftKey: string, id: string) => `${draftKey}/${id}`

export async function putDraftFile(draftKey: string, file: DraftFile): Promise<void> {
  const row: Row = { ...file, key: keyOf(draftKey, file.id), draftKey }
  await run("readwrite", (store) => void store.put(row)).catch(() => {})
}

export async function deleteDraftFile(draftKey: string, id: string): Promise<void> {
  await run("readwrite", (store) => void store.delete(keyOf(draftKey, id))).catch(() => {})
}

export async function listDraftFiles(draftKey: string): Promise<DraftFile[]> {
  const rows = await run<Row[]>("readonly", (store) => store.index("draftKey").getAll(draftKey)).catch(() => undefined)
  return (rows ?? []).map(({ id, name, type, size, blob }) => ({ id, name, type, size, blob }))
}

export async function clearDraftFiles(draftKey: string): Promise<void> {
  await run("readwrite", (store) => {
    const request = store.index("draftKey").openKeyCursor(IDBKeyRange.only(draftKey))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      store.delete(cursor.primaryKey)
      cursor.continue()
    }
  }).catch(() => {})
}
