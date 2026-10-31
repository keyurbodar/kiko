import { THOUGHTS_DATABASE } from "../lib/storage"
import type { Thought } from "./thoughts"

const STORE = "rooms"

export type SavedThoughts = Readonly<Record<string, readonly Thought[]>>

let opened: Promise<IDBDatabase | null> | undefined

function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null)
    const request = indexedDB.open(THOUGHTS_DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => {
      const db = request.result
      db.addEventListener("versionchange", () => {
        db.close()
        opened = undefined
      })
      resolve(db)
    }
    request.addEventListener("error", () => resolve(null))
  })
  return opened
}

export async function readThoughts(roomId: string): Promise<SavedThoughts> {
  const db = await open()
  if (!db) return {}
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(roomId)
      request.addEventListener("success", () => resolve((request.result as SavedThoughts | undefined) ?? {}))
      request.addEventListener("error", () => resolve({}))
    } catch {
      resolve({})
    }
  })
}

export async function writeThoughts(roomId: string, all: SavedThoughts): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(all, roomId)
  } catch {}
}
