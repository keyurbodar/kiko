import { type Keyring, open, seal } from "@kiko/durable/crypto"
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
  }

  target(): Promise<StoredTarget | undefined> {
    const row = this.sql.exec<KeyRow>("SELECT kek_version, iv, ciphertext, value FROM composio WHERE name = 'key'").toArray()[0]
    if (!row) return Promise.resolve(undefined)
    const session = JSON.parse(row.value) as Session
    return open(this.keyring, this.userId, AAD, { kekVersion: row.kek_version, iv: new Uint8Array(row.iv), ciphertext: new Uint8Array(row.ciphertext) }).then((key) => ({ key, url: session.url, session: session.id }))
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
