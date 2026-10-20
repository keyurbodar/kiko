import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai"
import { type Keyring, open, seal } from "@kiko/durable/crypto"
import type { ProviderInfo, ProviderProblem } from "@kiko/protocol"

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
  const id = name ? /^user:([A-Za-z0-9_-]{1,64})$/.exec(name)?.[1] : undefined
  if (id === undefined) throw new CredentialError("this object has no user name")
  return id
}

function last4(credential: Credential): string {
  if (credential.type !== "api_key" || !credential.key || credential.key.length < MIN_KEY_FOR_LAST4) return ""
  return credential.key.slice(-4)
}

type Row = { kind: string; kek_version: number; iv: ArrayBuffer; ciphertext: ArrayBuffer }

export class CredentialVault implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(
    private readonly sql: SqlStorage,
    /** Read only when a secret is sealed or opened, so listing providers needs no key. */
    private readonly keyring: () => Keyring,
    private readonly userId: string,
    /** Called after any write. The listed providers may have changed. */
    private readonly onChange: () => void = () => {},
  ) {
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    return this.load(providerId)
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
      const current = await this.load(providerId)
      const next = await fn(current)
      options?.signal?.throwIfAborted()
      if (next !== undefined) await this.store(providerId, next)
      return next ?? current
    })
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(providerId, async () => {
      options?.signal?.throwIfAborted()
      this.sql.exec("DELETE FROM credentials WHERE provider_id = ?", providerId)
      this.onChange()
    })
  }

  async connect(provider: string, apiKey: unknown): Promise<ProviderInfo> {
    if (!isProviderId(provider)) throw new CredentialError("bad provider id")
    const key = checkApiKey(apiKey)
    await this.modify(provider, async () => ({ type: "api_key", key }))
    const info = this.info(provider)
    if (!info) throw new CredentialError("provider is missing right after connect")
    return info
  }

  async disconnect(provider: string): Promise<boolean> {
    if (!isProviderId(provider)) return false
    const existed = this.info(provider) !== null
    await this.delete(provider)
    return existed
  }

  listProviders(): ProviderInfo[] {
    return this.sql
      .exec<{ provider_id: string; kind: string; last4: string; problem: string | null; problem_at: number | null }>(
        "SELECT provider_id, kind, last4, problem, problem_at FROM credentials ORDER BY provider_id",
      )
      .toArray()
      .map((r) => ({
        provider: r.provider_id,
        kind: r.kind as ProviderInfo["kind"],
        last4: r.last4,
        ...(r.problem ? { problem: r.problem as ProviderProblem, problemAt: r.problem_at ?? 0 } : {}),
      }))
  }

  problem(provider: string): ProviderProblem | undefined {
    return this.info(provider)?.problem
  }

  /** Notes why a provider stopped working, or clears it with null. Returns whether the stored problem changed. */
  setProblem(provider: string, problem: ProviderProblem | null): boolean {
    const row = this.info(provider)
    if (!row || row.problem === (problem ?? undefined)) return false
    if (problem === null) this.sql.exec("UPDATE credentials SET problem = NULL, problem_at = NULL WHERE provider_id = ?", provider)
    else this.sql.exec("UPDATE credentials SET problem = ?, problem_at = ? WHERE provider_id = ?", problem, Date.now(), provider)
    this.onChange()
    return true
  }

  private info(provider: string): ProviderInfo | null {
    return this.listProviders().find((p) => p.provider === provider) ?? null
  }

  private async load(providerId: string): Promise<Credential | undefined> {
    const row = this.sql
      .exec<Row>("SELECT kind, kek_version, iv, ciphertext FROM credentials WHERE provider_id = ?", providerId)
      .toArray()[0]
    if (!row) return undefined
    const plain = await open(this.keyring(), this.userId, providerId, {
      kekVersion: row.kek_version,
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    })
    return JSON.parse(plain) as Credential
  }

  private async store(providerId: string, credential: Credential): Promise<void> {
    const sealed = await seal(this.keyring(), this.userId, providerId, JSON.stringify(credential))
    this.sql.exec(
      `INSERT INTO credentials (provider_id, kind, last4, kek_version, iv, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider_id) DO UPDATE SET kind = excluded.kind, last4 = excluded.last4,
         kek_version = excluded.kek_version, iv = excluded.iv, ciphertext = excluded.ciphertext,
         updated_at = excluded.updated_at, problem = NULL, problem_at = NULL`,
      providerId,
      credential.type,
      last4(credential),
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      Date.now(),
    )
    this.onChange()
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
