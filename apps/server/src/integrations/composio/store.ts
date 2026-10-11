import { type Keyring, open, seal } from "@yuki/durable/crypto"
import type { ComposioTool, Session, Target } from "./client"
import type { LearnedTool } from "./learn"

export type SavedListing = { at: number; tools: ComposioTool[] }
export type StoredTarget = Target & { session: string }

type KeyRow = { kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer; value: string }

const AAD = "composio/key"

export class ComposioStore {
  #generation = 0

  get generation(): number {
    return this.#generation
  }

  constructor(
    private readonly sql: SqlStorage,
    private readonly keyring: Keyring,
    private readonly userId: string,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS composio (
      name TEXT PRIMARY KEY,
      kek_version INTEGER,
      iv BLOB,
      ciphertext BLOB,
      value TEXT,
      updated_at INTEGER NOT NULL
    )`)
    // Until 2026-10-11 the key was a consumer key with no session. A store without a session is
    // unusable, so it is dropped and the user pastes the key again.
    sql.exec("DELETE FROM composio WHERE NOT EXISTS (SELECT 1 FROM composio WHERE name = 'key' AND value IS NOT NULL)")
  }

  /** Read before the first await, so a caller that clears the store right after still gets what was stored. */
  target(): Promise<StoredTarget | undefined> {
    const row = this.sql.exec<KeyRow>("SELECT kek_version, iv, ciphertext, value FROM composio WHERE name = 'key'").toArray()[0]
    if (!row) return Promise.resolve(undefined)
    const session = JSON.parse(row.value) as Session
    const generation = this.generation
    return open(this.keyring, this.userId, AAD, { kekVersion: row.kek_version, iv: new Uint8Array(row.iv), ciphertext: new Uint8Array(row.ciphertext) }).then(async (key) => {
      if (row.kek_version !== this.keyring.current.version) await this.resealKey(key, row, generation)
      return { key, url: session.url, session: session.id }
    })
  }

  async putKey(key: string, session: Session, generation = this.generation): Promise<void> {
    const sealed = await seal(this.keyring, this.userId, AAD, key)
    if (generation !== this.generation) return
    this.sql.exec(
      `INSERT INTO composio (name, kek_version, iv, ciphertext, value, updated_at) VALUES ('key', ?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET kek_version = excluded.kek_version, iv = excluded.iv,
         ciphertext = excluded.ciphertext, value = excluded.value, updated_at = excluded.updated_at`,
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      JSON.stringify(session),
      Date.now(),
    )
  }

  /** Re-seals only the key columns, so a session written meanwhile is not overwritten. */
  private async resealKey(key: string, old: KeyRow, generation: number): Promise<void> {
    const sealed = await seal(this.keyring, this.userId, AAD, key)
    if (generation !== this.generation) return
    this.sql.exec(
      "UPDATE composio SET kek_version = ?, iv = ?, ciphertext = ?, updated_at = ? WHERE name = 'key' AND kek_version = ? AND ciphertext = ?",
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      Date.now(),
      old.kek_version,
      old.ciphertext,
    )
  }

  putSession(session: Session, generation = this.generation): void {
    if (generation !== this.generation) return
    this.sql.exec("UPDATE composio SET value = ?, updated_at = ? WHERE name = 'key'", JSON.stringify(session), Date.now())
  }

  listing(): SavedListing | undefined {
    return this.value<SavedListing>("listing")
  }

  putListing(listing: SavedListing, generation = this.generation): void {
    this.putValue("listing", listing, generation)
  }

  learned(): LearnedTool[] {
    return this.value<LearnedTool[]>("learned") ?? []
  }

  putLearned(learned: LearnedTool[], generation = this.generation): void {
    this.putValue("learned", learned, generation)
  }

  private value<T>(name: string): T | undefined {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM composio WHERE name = ?", name).toArray()[0]
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  private putValue(name: string, value: unknown, generation: number): void {
    if (generation !== this.generation || !this.connected()) return
    this.sql.exec(
      `INSERT INTO composio (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      name,
      JSON.stringify(value),
      Date.now(),
    )
  }

  connected(): boolean {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM composio WHERE name = 'key'").one().n > 0
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM composio").one().n
  }

  clear(): number {
    this.#generation++
    const removed = this.count()
    this.sql.exec("DELETE FROM composio")
    return removed
  }
}
