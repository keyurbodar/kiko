import type { McpOAuthState, McpOAuthStateStore } from "@earendil-works/pi-mcp/oauth"
import { type Keyring, open, seal } from "@yuki/durable/crypto"

export type ExecutorSecret = "oauth" | "redirect" | "api_key"

type Row = { kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer }

export function migrateExecutor(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS executor_secrets (
    name TEXT PRIMARY KEY,
    kek_version INTEGER NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
}

const aadName = (name: ExecutorSecret) => `executor/${name}`

export class ExecutorTokenStore {
  #generation = 0
  get generation(): number {
    return this.#generation
  }

  constructor(
    private readonly sql: SqlStorage,
    private readonly keyring: Keyring,
    private readonly userId: string,
    private readonly transaction: (fn: () => void) => void,
  ) {
    migrateExecutor(sql)
  }

  async get<T>(name: ExecutorSecret): Promise<T | undefined> {
    const row = this.sql
      .exec<Row>("SELECT kek_version, iv, ciphertext FROM executor_secrets WHERE name = ?", name)
      .toArray()[0]
    if (!row) return undefined
    const plain = await open(this.keyring, this.userId, aadName(name), {
      kekVersion: row.kek_version,
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    })
    const value = JSON.parse(plain) as T
    if (row.kek_version !== this.keyring.current.version) await this.put(name, value)
    return value
  }

  async put(name: ExecutorSecret, value: unknown, generation = this.generation): Promise<void> {
    if (generation !== this.generation) return
    const sealed = await seal(this.keyring, this.userId, aadName(name), JSON.stringify(value))
    if (generation !== this.generation) return
    this.sql.exec(
      `INSERT INTO executor_secrets (name, kek_version, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET kek_version = excluded.kek_version, iv = excluded.iv,
         ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      name,
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      Date.now(),
    )
  }

  remove(name: ExecutorSecret): void {
    this.sql.exec("DELETE FROM executor_secrets WHERE name = ?", name)
  }

  clear(): number {
    this.#generation++
    let removed = 0
    this.transaction(() => {
      removed = this.count()
      this.sql.exec("DELETE FROM executor_secrets")
    })
    return removed
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM executor_secrets").one().n
  }

  oauth(generation = this.generation): McpOAuthStateStore {
    return {
      load: () => this.get<McpOAuthState>("oauth"),
      save: (state) => this.put("oauth", state, generation),
    }
  }
}
