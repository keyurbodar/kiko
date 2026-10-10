import { type Keyring, open, seal } from "@yuki/durable/crypto"
import type { ComposioTool } from "./client"

/**
 * One user's Composio rows in `UserDO`. `key` is the sealed consumer key, with the same keyring and
 * AAD scheme as Executor's secrets. `listing` is the last tool listing, plain JSON because it holds
 * no secret, kept so a cold object serves it at once. Disconnect deletes every row.
 */
export type SavedListing = { at: number; tools: ComposioTool[] }

type KeyRow = { kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer }

const KEY_AAD = "composio/key"

export class ComposioStore {
  #generation = 0
  /** Bumped by `clear`, so a write that started before a disconnect is dropped. */
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
  }

  async key(): Promise<string | undefined> {
    const row = this.sql.exec<KeyRow>("SELECT kek_version, iv, ciphertext FROM composio WHERE name = 'key'").toArray()[0]
    if (!row) return undefined
    const key = await open(this.keyring, this.userId, KEY_AAD, {
      kekVersion: row.kek_version,
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    })
    if (row.kek_version !== this.keyring.current.version) await this.putKey(key)
    return key
  }

  async putKey(key: string, generation = this.generation): Promise<void> {
    const sealed = await seal(this.keyring, this.userId, KEY_AAD, key)
    if (generation !== this.generation) return
    this.sql.exec(
      `INSERT INTO composio (name, kek_version, iv, ciphertext, updated_at) VALUES ('key', ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET kek_version = excluded.kek_version, iv = excluded.iv,
         ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      Date.now(),
    )
  }

  listing(): SavedListing | undefined {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM composio WHERE name = 'listing'").toArray()[0]
    return row ? (JSON.parse(row.value) as SavedListing) : undefined
  }

  putListing(listing: SavedListing, generation = this.generation): void {
    if (generation !== this.generation || !this.connected()) return
    this.sql.exec(
      `INSERT INTO composio (name, value, updated_at) VALUES ('listing', ?, ?)
       ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify(listing),
      Date.now(),
    )
  }

  connected(): boolean {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM composio WHERE name = 'key'").one().n > 0
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM composio").one().n
  }

  /** Deletes every row. Returns how many there were. */
  clear(): number {
    this.#generation++
    const removed = this.count()
    this.sql.exec("DELETE FROM composio")
    return removed
  }
}
