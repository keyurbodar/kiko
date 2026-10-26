import { type Keyring, open, seal } from "@kiko/durable/crypto"
import { sha256Hex, toHex } from "@kiko/durable/hash"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import {
  type CliSession,
  claimUrl,
  type Deployed,
  type DeployOptions,
  type DeployRecord,
  type Envelope,
  Lakebed,
  LakebedError,
} from "./lakebed"

export type Target = "anonymous" | "claimed"
export type Diagnostic = { path?: string; file?: string; line?: number; message: string }
export type BuildResult = { ok: true; envelope: Envelope } | { ok: false; diagnostics: Diagnostic[] }
export type Builder = (files: Record<string, string>, target: Target) => Promise<BuildResult>

export type AppSummary = { name: string; url: string; claimed: boolean; expiresAt: string | null; updatedAt: number }
export type DeployOutcome =
  | { ok: true; app: AppSummary; changed: boolean; claim?: ClaimLink }
  | { ok: false; diagnostics: Diagnostic[] }
  | { ok: false; error: string }
export type CallResult = { status: number; body: string; bytes: Uint8Array; type: string }
export type InspectWhat = "logs" | "tables" | "db" | "manifest" | "usage" | "storage" | "export"
export type AccountStatus =
  | { state: "connected"; login: string | null }
  | { state: "waiting"; url: string; code: string }
  | { state: "none" }
export type ClaimLink = { url: string; code: string }
export type AppsOverview = { account: AccountStatus; apps: AppSummary[] }

type Secrets = { key: string; claimToken?: string; env?: Record<string, string> }
type Account = { token?: string; login?: string | null; session?: CliSession }
type Row = {
  name: string
  deploy_id: string
  url: string
  claimed: number
  expires_at: string | null
  artifact_hash: string
  kek_version: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updated_at: number
}
type Live = { row: Row; secrets: Secrets }

const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const KIKO_MODULE = "server/kiko.ts"
const SECRETS_AAD = "apps/secrets"
const ACCOUNT_AAD = "apps/lakebed-account"
const ACCOUNT_SETTING = "lakebedAccount"
const CLAIM_DIAGNOSTIC = /fetch/i
const SESSION_MARGIN_MS = 60_000
const INSPECT_PATHS: Record<InspectWhat, string> = {
  logs: "/__lakebed/logs",
  tables: "/__lakebed/db/tables",
  db: "/__lakebed/db",
  manifest: "/__lakebed/manifest",
  usage: "/__lakebed/usage",
  storage: "/__lakebed/storage",
  export: "/__lakebed/db/export",
}

const PLACEHOLDER_SERVER = `import { capsule } from "lakebed/server";

export default capsule({ name: "Claim Required", schema: {}, queries: {}, mutations: {} });
`
const PLACEHOLDER_CLIENT = `export function App() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-12 text-neutral-100">
      <h1 className="text-3xl font-semibold">Claim required</h1>
      <p className="mt-4 text-neutral-300">This app needs a claimed deploy. It goes live once its owner claims it.</p>
    </main>
  );
}
`

const summary = (row: Row): AppSummary => ({
  name: row.name,
  url: row.url,
  claimed: row.claimed === 1,
  expiresAt: row.expires_at,
  updatedAt: row.updated_at,
})

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

function kikoModule(keySha256: string): string {
  return `const KEY_SHA256 = "${keySha256}";

export async function isKiko(req: { headers: { get(name: string): string | null } }): Promise<boolean> {
  const key = req.headers.get("x-kiko-key");
  if (!key) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex === KEY_SHA256;
}
`
}

const needsClaim = (diagnostics: Diagnostic[]) =>
  diagnostics.length > 0 && diagnostics.every((d) => CLAIM_DIAGNOSTIC.test(d.message))

const CLAIM_FIRST =
  "This app uses server fetch or env, which only a claimed deploy runs. Get the claim link with app_manage claim_link and give it to the human, then deploy again once they claim it."

export class Apps {
  private readonly lakebed: Lakebed

  constructor(
    private readonly sql: SqlStorage,
    private readonly keyring: Keyring,
    private readonly ownerId: string,
    private readonly build: Builder,
    private readonly egress: typeof fetch,
  ) {
    this.lakebed = new Lakebed(egress)
  }

  list(): AppSummary[] {
    return this.sql.exec<Row>("SELECT * FROM apps ORDER BY name").toArray().map(summary)
  }

  async accountDeploys(): Promise<unknown> {
    const token = await this.accountToken()
    return token ? this.lakebed.deploys(token) : null
  }

  async deploy(name: string, files: Record<string, string>, options: DeployOptions = {}): Promise<DeployOutcome> {
    if (!APP_NAME.test(name)) return { ok: false, error: "Name apps with 3-40 lowercase letters, digits or dashes." }
    try {
      return await this.deployChecked(name, files, options)
    } catch (e) {
      if (e instanceof LakebedError) return { ok: false, error: e.message }
      throw e
    }
  }

  private async deployChecked(name: string, files: Record<string, string>, options: DeployOptions) {
    const row = this.row(name)
    const secrets: Secrets = row ? await this.secrets(row) : { key: toHex(crypto.getRandomValues(new Uint8Array(24))) }
    const record: DeployRecord | "gone" = row ? await this.lakebed.record(row.deploy_id) : "gone"
    const account = await this.accountToken()
    const live = record !== "gone"
    const claimed = live ? record.claimed : Boolean(account)
    if (live && record.claimed && !account)
      return {
        ok: false as const,
        error:
          "This app is claimed. Connect the human's Lakebed account with lakebed_account connect, then deploy again.",
      }
    const source = { ...files, [KIKO_MODULE]: kikoModule(await sha256Hex(secrets.key)) }
    const built = await this.build(source, claimed ? "claimed" : "anonymous")
    const env = secrets.env ?? {}
    if (!claimed && (built.ok ? Object.keys(env).length > 0 : needsClaim(built.diagnostics)))
      return this.claimFirst(name, row, live, secrets)
    if (!built.ok) return { ok: false as const, diagnostics: built.diagnostics }
    if (row && live && row.artifact_hash === built.envelope.artifactHash && !options.deleteTables?.length)
      return { ok: true as const, app: summary(row), changed: false }
    const send: DeployOptions = { ...options, ...(claimed ? { serverEnv: env } : {}) }
    const token = claimed ? account : (secrets.claimToken ?? null)
    const updated =
      row && live && token
        ? await this.lakebed.update(row.deploy_id, token, built.envelope, send, secrets.claimToken ?? null)
        : "gone"
    if (updated === "gone" && options.deleteTables?.length)
      return { ok: false as const, error: "delete_tables needs an existing deploy. Nothing was created." }
    const result = updated === "gone" ? await this.lakebed.create(built.envelope, send, account) : updated
    const app = await this.save(name, result, built.envelope.artifactHash, {
      ...secrets,
      ...this.claimTokenOf(result, secrets),
    })
    if (app.claimed) return { ok: true as const, app, changed: true }
    return { ok: true as const, app, changed: true, claim: await this.claimLink(name) }
  }

  private claimTokenOf(result: Deployed, secrets: Secrets): Pick<Secrets, "claimToken"> {
    const token = result.claimToken ?? secrets.claimToken
    return token ? { claimToken: token } : {}
  }

  private async claimFirst(
    name: string,
    row: Row | undefined,
    live: boolean,
    secrets: Secrets,
  ): Promise<DeployOutcome> {
    if (row && live) return { ok: false, error: CLAIM_FIRST }
    const built = await this.build(
      { "server/index.ts": PLACEHOLDER_SERVER, "client/index.tsx": PLACEHOLDER_CLIENT },
      "anonymous",
    )
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics }
    const result = await this.lakebed.create(built.envelope, {}, null)
    await this.save(name, result, "", { ...secrets, ...this.claimTokenOf(result, secrets) })
    return { ok: false, error: `${CLAIM_FIRST} Until then ${result.url} shows a claim-required page.` }
  }

  async inspect(name: string, what: InspectWhat, params: Record<string, string> = {}): Promise<string> {
    const { row, secrets } = await this.require(name)
    const token = row.claimed ? await this.requireAccount() : this.claimTokenFor(secrets)
    const query = new URLSearchParams(params).toString()
    return this.lakebed.inspect(row.url, token, `${INSPECT_PATHS[what]}${query ? `?${query}` : ""}`)
  }

  async call(
    name: string,
    method: string,
    path: string,
    body: string | Uint8Array | undefined,
    type?: string,
  ): Promise<CallResult> {
    const { row, secrets } = await this.require(name)
    const headers: Record<string, string> = { "x-kiko-key": secrets.key }
    if (body !== undefined) headers["content-type"] = type ?? "application/json"
    const response = await this.egress(new URL(path, row.url).toString(), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get("content-type") ?? "application/octet-stream"
    return { status: response.status, body: new TextDecoder().decode(bytes), bytes, type: contentType }
  }

  async env(name: string, set: Record<string, string>, unset: string[]): Promise<string[]> {
    const { row, secrets } = await this.require(name)
    const bad = Object.keys(set).find((key) => !ENV_KEY.test(key) || key.startsWith("LAKEBED_"))
    if (bad)
      throw new LakebedError(`${bad} is not a valid env name. Use letters, digits and _, not starting with LAKEBED_.`)
    const env = { ...secrets.env, ...set }
    for (const key of unset) delete env[key]
    const changed = JSON.stringify(env) !== JSON.stringify(secrets.env ?? {})
    if (changed) await this.reseal(row, { ...secrets, env }, "")
    return Object.keys(env).sort()
  }

  async domains(name: string, action: "add" | "status" | "list" | "remove", hostname?: string): Promise<unknown> {
    const { row, secrets } = await this.require(name)
    const token = (await this.accountToken()) ?? this.claimTokenFor(secrets)
    return this.lakebed.domains(token, row.deploy_id, action, hostname)
  }

  async users(name: string, action: "list" | "approve" | "deny" | "remove", subject?: string): Promise<unknown> {
    const { row, secrets } = await this.require(name)
    const token = row.claimed ? await this.requireAccount() : (secrets.claimToken ?? (await this.requireAccount()))
    return this.lakebed.users(token, row.deploy_id, action, subject)
  }

  async lifecycle(name: string, action: "archive" | "restore" | "terminate"): Promise<unknown> {
    const { row } = await this.require(name)
    return this.lakebed.lifecycle(await this.requireAccount(), row.deploy_id, action)
  }

  async storageDelete(name: string, key: string): Promise<unknown> {
    const { row } = await this.require(name)
    return this.lakebed.deleteStored(await this.requireAccount(), row.deploy_id, key)
  }

  async storageGet(name: string, key: string): Promise<CallResult> {
    const { row } = await this.require(name)
    const response = await this.egress(new URL(`/storage/${key}`, row.url).toString())
    const bytes = new Uint8Array(await response.arrayBuffer())
    const type = response.headers.get("content-type") ?? "application/octet-stream"
    return { status: response.status, body: "", bytes, type }
  }

  async claimLink(name: string): Promise<ClaimLink> {
    const { row, secrets } = await this.require(name)
    if (row.claimed) throw new LakebedError(`${name} is already claimed.`)
    const session = await this.pendingSession()
    return { url: claimUrl(row.deploy_id, this.claimTokenFor(secrets), session.sessionId), code: session.code }
  }

  async signedHeaders(url: URL): Promise<Record<string, string> | null> {
    const row = this.sql
      .exec<Row>("SELECT * FROM apps")
      .toArray()
      .find((candidate) => new URL(candidate.url).origin === url.origin)
    return row ? { "x-kiko-key": (await this.secrets(row)).key } : null
  }

  forget(name: string): boolean {
    return this.sql.exec("DELETE FROM apps WHERE name = ?", name).rowsWritten > 0
  }

  async connect(): Promise<AccountStatus> {
    const current = await this.status()
    if (current.state === "connected") return current
    const session = await this.pendingSession()
    return { state: "waiting", url: session.verificationUrl, code: session.code }
  }

  async overview(): Promise<AppsOverview> {
    const account = await this.status()
    for (const row of this.sql.exec<Row>("SELECT * FROM apps WHERE claimed = 0").toArray()) {
      const record = await this.lakebed.record(row.deploy_id).catch(() => "gone" as const)
      if (record !== "gone" && record.claimed)
        this.sql.exec("UPDATE apps SET claimed = 1, expires_at = NULL WHERE name = ?", row.name)
    }
    return { account, apps: this.list() }
  }

  private async pendingSession(): Promise<CliSession> {
    const account = await this.readAccount()
    if (account.session && Date.parse(account.session.expiresAt) - SESSION_MARGIN_MS > Date.now())
      return account.session
    const session = await this.lakebed.startSession()
    await this.writeAccount({ ...account, session })
    return session
  }

  async status(): Promise<AccountStatus> {
    const account = await this.settle()
    if (account.token) return { state: "connected", login: account.login ?? null }
    if (account.session) return { state: "waiting", url: account.session.verificationUrl, code: account.session.code }
    return { state: "none" }
  }

  disconnect(): void {
    deleteSetting(this.sql, ACCOUNT_SETTING)
  }

  private async accountToken(): Promise<string | null> {
    return (await this.settle()).token ?? null
  }

  private async requireAccount(): Promise<string> {
    const token = await this.accountToken()
    if (!token)
      throw new LakebedError("This needs the human's Lakebed account. Connect it with lakebed_account connect.")
    return token
  }

  private claimTokenFor(secrets: Secrets): string {
    if (!secrets.claimToken) throw new LakebedError("Kiko has no deploy token for this app. Deploy it again.")
    return secrets.claimToken
  }

  private async settle(): Promise<Account> {
    const account = await this.readAccount()
    if (!account.session) return account
    const answer =
      Date.parse(account.session.expiresAt) < Date.now() ? "expired" : await this.lakebed.exchange(account.session)
    if (answer === "pending") return account
    const next: Account =
      answer === "expired"
        ? { token: account.token, login: account.login }
        : { token: answer.token, login: answer.login }
    await this.writeAccount(next)
    return next
  }

  private async readAccount(): Promise<Account> {
    const text = getSetting(this.sql, ACCOUNT_SETTING)
    if (!text) return {}
    const stored = JSON.parse(text) as { k: number; iv: string; ct: string }
    const opened = await open(this.keyring, this.ownerId, ACCOUNT_AAD, {
      kekVersion: stored.k,
      iv: unb64(stored.iv),
      ciphertext: unb64(stored.ct),
    })
    return JSON.parse(opened) as Account
  }

  private async writeAccount(account: Account): Promise<void> {
    const sealed = await seal(this.keyring, this.ownerId, ACCOUNT_AAD, JSON.stringify(account))
    setSetting(
      this.sql,
      ACCOUNT_SETTING,
      JSON.stringify({ k: sealed.kekVersion, iv: b64(sealed.iv), ct: b64(sealed.ciphertext) }),
    )
  }

  private row(name: string): Row | undefined {
    return this.sql.exec<Row>("SELECT * FROM apps WHERE name = ?", name).toArray()[0]
  }

  private async require(name: string): Promise<Live> {
    const row = this.row(name)
    if (!row) throw new LakebedError(`No app named ${name}. Deploy it first with app_deploy.`)
    return { row, secrets: await this.secrets(row) }
  }

  private async secrets(row: Row): Promise<Secrets> {
    const text = await open(this.keyring, this.ownerId, SECRETS_AAD, {
      kekVersion: row.kek_version,
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    })
    return JSON.parse(text) as Secrets
  }

  private async reseal(row: Row, secrets: Secrets, artifactHash: string): Promise<void> {
    const sealed = await seal(this.keyring, this.ownerId, SECRETS_AAD, JSON.stringify(secrets))
    this.sql.exec(
      "UPDATE apps SET kek_version = ?, iv = ?, ciphertext = ?, artifact_hash = ? WHERE name = ?",
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      artifactHash,
      row.name,
    )
  }

  private async save(name: string, deployed: Deployed, artifactHash: string, secrets: Secrets): Promise<AppSummary> {
    const sealed = await seal(this.keyring, this.ownerId, SECRETS_AAD, JSON.stringify(secrets))
    const updatedAt = Date.now()
    this.sql.exec(
      `INSERT INTO apps (name, deploy_id, url, claimed, expires_at, artifact_hash, kek_version, iv, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET deploy_id = excluded.deploy_id, url = excluded.url, claimed = excluded.claimed,
         expires_at = excluded.expires_at, artifact_hash = excluded.artifact_hash, kek_version = excluded.kek_version,
         iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      name,
      deployed.deployId,
      deployed.url,
      deployed.claimed ? 1 : 0,
      deployed.expiresAt,
      artifactHash,
      sealed.kekVersion,
      sealed.iv,
      sealed.ciphertext,
      updatedAt,
    )
    return { name, url: deployed.url, claimed: deployed.claimed, expiresAt: deployed.expiresAt, updatedAt }
  }
}
