const AUTH_KEY = "kiko:auth"
export const RUNTIME_DATABASE = "kiko:client-runtime"
export const COMPOSER_DATABASE = "kiko-composer"
export const PREVIEW_DATABASE = "kiko:file-previews"
export const THOUGHTS_DATABASE = "kiko:thoughts"

const SIGNING_OUT_KEY = "kiko:signing-out"
const SCHEMA_KEY = "kiko:schema"
const SCHEMA = "1"
const DEVICE_PREFIX = "kiko:device:"
const LEGACY_DATABASE = /^kiko:warm:/

const ours = (key: string) => key.startsWith("kiko:") || key.startsWith("kiko.")
const kept = (key: string) => key.startsWith(DEVICE_PREFIX) || key === SIGNING_OUT_KEY || key === SCHEMA_KEY

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

function clear(storage: Storage, keep: (key: string) => boolean): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
  for (const key of keys) if (key !== null && ours(key) && !keep(key)) storage.removeItem(key)
}

function clearKeys(): void {
  try {
    clear(localStorage, kept)
    clear(sessionStorage, () => false)
  } catch {}
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.addEventListener("success", () => resolve())
    request.addEventListener("blocked", () => resolve())
    request.addEventListener("error", () => reject(request.error))
  })
}

async function deleteDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const listed = await indexedDB.databases().catch(() => [])
  const legacy = listed.map((database) => database.name ?? "").filter((name) => LEGACY_DATABASE.test(name))
  await Promise.all(
    [RUNTIME_DATABASE, COMPOSER_DATABASE, PREVIEW_DATABASE, THOUGHTS_DATABASE, ...legacy].map(deleteDatabase),
  )
}

export async function purge(): Promise<void> {
  clearKeys()
  await deleteDatabases()
}

export function prepareStorage(): void {
  if (read(SCHEMA_KEY) === SCHEMA) return
  clearKeys()
  write(SCHEMA_KEY, SCHEMA)
  void deleteDatabases().catch(() => {})
}

export const hasAuth = (): boolean => read(AUTH_KEY) !== null

export const signingOut = (): boolean => read(SIGNING_OUT_KEY) !== null

export const setSigningOut = (on: boolean): void => write(SIGNING_OUT_KEY, on ? "1" : null)

export const readAuth = (): string | null => read(AUTH_KEY)

export const writeAuth = (value: string | null): void => write(AUTH_KEY, value)

export function onAuthChange(listener: (raw: string | null) => void): () => void {
  const changed = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return
    if (event.key === AUTH_KEY) listener(event.newValue)
    else if (event.key === null) listener(read(AUTH_KEY))
  }
  addEventListener("storage", changed)
  return () => removeEventListener("storage", changed)
}
