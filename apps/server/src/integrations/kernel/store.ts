import { type Keyring, open, seal } from "@yuki/durable/crypto"
import type { Mode } from "./client"

/**
 * One user's Kernel rows in `UserDO`. `kernel` holds the sealed key (AAD `kernel/key`) and plain
 * flags. `kernel_lease` holds the one browser: its CDP and live view URLs are sealed together
 * (AAD `kernel/lease`), because each is a bearer capability for the life of the browser. Tab URLs
 * are plain and never leave the object. Disconnect deletes every row.
 */

export type Tabs = Record<string, Record<string, string>>

export type LeaseRow = {
  sessionId: string
  mode: Mode
  createdAt: number
  lastUse: number
  tabs: Tabs
  takeover: boolean
  watchUntil: number
  dead: boolean
}

export type LeaseUrls = { cdpUrl: string; liveUrl?: string }

type Sealed = { kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer }
type LeaseSql = Sealed & {
  session_id: string
  mode: Mode
  created_at: number
  last_use: number
  tabs: string
  takeover: number
  watch_until: number
  dead: number
}

const KEY_AAD = "kernel/key"
const LEASE_AAD = "kernel/lease"

export class KernelStore {
  #generation = 0
  /** Bumped by `clear`, so a write that started before a disconnect is dropped. */
  get generation(): number {
    return this.#generation
  }

  constructor(
    private readonly sql: SqlStorage,
    // Resolved only when sealing or opening, so reading browser state needs no key ring.
    private readonly secrets: () => { keyring: Keyring; userId: string },
  ) {
  }

  connected(): boolean {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM kernel WHERE name = 'key'").one().n > 0
  }

  async key(): Promise<string | undefined> {
    const row = this.sql.exec<Sealed>("SELECT kek_version, iv, ciphertext FROM kernel WHERE name = 'key'").toArray()[0]
    if (!row) return undefined
    const key = await open(this.secrets().keyring, this.secrets().userId, KEY_AAD, { kekVersion: row.kek_version, iv: new Uint8Array(row.iv), ciphertext: new Uint8Array(row.ciphertext) })
    if (row.kek_version !== this.secrets().keyring.current.version) await this.putKey(key)
    return key
  }

  async putKey(key: string, generation = this.generation): Promise<void> {
    const sealed = await seal(this.secrets().keyring, this.secrets().userId, KEY_AAD, key)
    if (generation !== this.generation) return
    this.sql.exec(
      `INSERT INTO kernel (name, kek_version, iv, ciphertext, updated_at) VALUES ('key', ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET kek_version = excluded.kek_version, iv = excluded.iv,
         ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      Date.now(),
    )
  }

  broken(): boolean {
    return this.flag("broken")
  }

  setBroken(on: boolean): void {
    this.setFlag("broken", on)
  }

  profileReady(): boolean {
    return this.flag("profile")
  }

  setProfileReady(on: boolean): void {
    this.setFlag("profile", on)
  }

  private flag(name: string): boolean {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM kernel WHERE name = ?", name).one().n > 0
  }

  private setFlag(name: string, on: boolean): void {
    if (!on) return void this.sql.exec("DELETE FROM kernel WHERE name = ?", name)
    if (!this.connected()) return
    this.sql.exec("INSERT OR IGNORE INTO kernel (name, value, updated_at) VALUES (?, '1', ?)", name, Date.now())
  }

  lease(): LeaseRow | undefined {
    const r = this.sql.exec<LeaseSql>("SELECT * FROM kernel_lease WHERE id = 1").toArray()[0]
    if (!r) return undefined
    return {
      sessionId: r.session_id,
      mode: r.mode,
      createdAt: r.created_at,
      lastUse: r.last_use,
      tabs: JSON.parse(r.tabs) as Tabs,
      takeover: r.takeover === 1,
      watchUntil: r.watch_until,
      dead: r.dead === 1,
    }
  }

  async urls(): Promise<LeaseUrls | undefined> {
    const r = this.sql.exec<Sealed>("SELECT kek_version, iv, ciphertext FROM kernel_lease WHERE id = 1").toArray()[0]
    if (!r) return undefined
    const text = await open(this.secrets().keyring, this.secrets().userId, LEASE_AAD, { kekVersion: r.kek_version, iv: new Uint8Array(r.iv), ciphertext: new Uint8Array(r.ciphertext) })
    return JSON.parse(text) as LeaseUrls
  }

  async putLease(row: LeaseRow, urls: LeaseUrls, generation = this.generation): Promise<boolean> {
    const sealed = await seal(this.secrets().keyring, this.secrets().userId, LEASE_AAD, JSON.stringify(urls))
    if (generation !== this.generation) return false
    this.sql.exec(
      `INSERT OR REPLACE INTO kernel_lease (id, session_id, mode, kek_version, iv, ciphertext, created_at, last_use, tabs, takeover, watch_until, dead)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.sessionId,
      row.mode,
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      row.createdAt,
      row.lastUse,
      JSON.stringify(row.tabs),
      row.takeover ? 1 : 0,
      row.watchUntil,
      row.dead ? 1 : 0,
    )
    return true
  }

  patchLease(patch: Partial<Pick<LeaseRow, "lastUse" | "tabs" | "takeover" | "watchUntil" | "dead">>): void {
    const flag = (on: boolean | undefined) => (on === undefined ? undefined : on ? 1 : 0)
    const columns: [string, SqlStorageValue | undefined][] = [
      ["last_use", patch.lastUse],
      ["tabs", patch.tabs && JSON.stringify(patch.tabs)],
      ["takeover", flag(patch.takeover)],
      ["watch_until", patch.watchUntil],
      ["dead", flag(patch.dead)],
    ]
    const set = columns.filter((c): c is [string, SqlStorageValue] => c[1] !== undefined)
    if (set.length) this.sql.exec(`UPDATE kernel_lease SET ${set.map(([c]) => `${c} = ?`).join(", ")} WHERE id = 1`, ...set.map(([, v]) => v))
  }

  deleteLease(): void {
    this.sql.exec("DELETE FROM kernel_lease")
  }

  clear(): void {
    this.#generation++
    this.sql.exec("DELETE FROM kernel")
    this.sql.exec("DELETE FROM kernel_lease")
  }
}
