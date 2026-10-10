import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai"
import { type Keyring, open, seal } from "@yuki/durable/crypto"

export interface ProviderInfo {
  provider: string
  kind: Credential["type"]
  last4: string
  /** The provider answered 401 or 403 to this key. Only a judge sets it. */
  refused?: true
  /** From pi-ai's catalog: the provider runs chat models, classifier models (a judge), or both. */
  chat?: boolean
  judge?: boolean
}

export class CredentialError extends Error {}

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_KEY_LENGTH = 8192
const MIN_KEY_FOR_LAST4 = 12

export function isProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID.test(value)
}

export function checkApiKey(value: unknown): string {
  if (typeof value !== "string") throw new CredentialError("api key must be a string")
  const key = value.trim()
  if (key.length === 0) throw new CredentialError("api key is empty")
  if (key.length > MAX_KEY_LENGTH) throw new CredentialError("api key is too long")
  return key
}

export function userIdFromObjectName(name: string | undefined): string {
  const match = name ? /^user:([A-Za-z0-9_-]{1,64})$/.exec(name) : null
  if (!match) throw new CredentialError("this object has no user name")
  return match[1]!
}

function last4(credential: Credential): string {
  if (credential.type !== "api_key" || !credential.key || credential.key.length < MIN_KEY_FOR_LAST4) return ""
  return credential.key.slice(-4)
}

function migrate(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS credentials (
    provider_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    last4 TEXT NOT NULL,
    kek_version INTEGER NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
}

type Row = { kind: string; kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer }

/**
 * pi-ai's `CredentialStore` over the `UserDO` SQLite, plus the connect, disconnect, and
 * list operations the RPC methods use. Writes for one provider run one at a time,
 * because `modify` may await a token refresh between its read and its write.
 */
export class CredentialVault implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(
    private readonly sql: SqlStorage,
    private readonly keyring: Keyring,
    private readonly userId: string,
  ) {
    migrate(sql)
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    const loaded = await this.load(providerId)
    if (loaded?.stale) await this.modify(providerId, async (current) => current)
    return loaded?.credential
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted()
    return this.listProviders().map((p) => ({ providerId: p.provider, type: p.kind }))
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      options?.signal?.throwIfAborted()
      const loaded = await this.load(providerId)
      const current = loaded?.credential
      const next = await fn(current)
      options?.signal?.throwIfAborted()
      const written = next ?? current
      if (written !== undefined && (next !== undefined || loaded?.stale)) await this.store(providerId, written)
      return written
    })
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(providerId, async () => {
      options?.signal?.throwIfAborted()
      this.sql.exec("DELETE FROM credentials WHERE provider_id = ?", providerId)
    })
  }

  async connect(provider: string, apiKey: unknown): Promise<ProviderInfo> {
    if (!isProviderId(provider)) throw new CredentialError("bad provider id")
    const key = checkApiKey(apiKey)
    await this.modify(provider, async () => ({ type: "api_key", key }))
    return this.info(provider)!
  }

  async disconnect(provider: string): Promise<boolean> {
    if (!isProviderId(provider)) return false
    const existed = this.info(provider) !== null
    await this.delete(provider)
    return existed
  }

  listProviders(): ProviderInfo[] {
    return this.sql
      .exec<{ provider_id: string; kind: string; last4: string }>(
        "SELECT provider_id, kind, last4 FROM credentials ORDER BY provider_id",
      )
      .toArray()
      .map((r) => ({ provider: r.provider_id, kind: r.kind as ProviderInfo["kind"], last4: r.last4 }))
  }

  private info(provider: string): ProviderInfo | null {
    return this.listProviders().find((p) => p.provider === provider) ?? null
  }

  private async load(providerId: string): Promise<{ credential: Credential; stale: boolean } | undefined> {
    const row = this.sql
      .exec<Row>("SELECT kind, kek_version, iv, ciphertext FROM credentials WHERE provider_id = ?", providerId)
      .toArray()[0]
    if (!row) return undefined
    const plain = await open(this.keyring, this.userId, providerId, {
      kekVersion: row.kek_version,
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    })
    return { credential: JSON.parse(plain) as Credential, stale: row.kek_version !== this.keyring.current.version }
  }

  private async store(providerId: string, credential: Credential): Promise<void> {
    const sealed = await seal(this.keyring, this.userId, providerId, JSON.stringify(credential))
    this.sql.exec(
      `INSERT INTO credentials (provider_id, kind, last4, kek_version, iv, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider_id) DO UPDATE SET kind = excluded.kind, last4 = excluded.last4,
         kek_version = excluded.kek_version, iv = excluded.iv, ciphertext = excluded.ciphertext,
         updated_at = excluded.updated_at`,
      providerId,
      credential.type,
      last4(credential),
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      Date.now(),
    )
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(task)
    const tail = run.catch(() => {})
    this.chains.set(providerId, tail)
    void tail.then(() => {
      if (this.chains.get(providerId) === tail) this.chains.delete(providerId)
    })
    return run
  }
}
