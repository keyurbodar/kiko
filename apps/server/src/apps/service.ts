import { type Keyring, open, seal } from "@kiko/durable/crypto"
import { sha256Hex, toHex } from "@kiko/durable/hash"
import {
  claimUrl,
  createDeploy,
  type Deployed,
  deployStatus,
  type Envelope,
  inspect,
  LakebedError,
  updateDeploy,
} from "./lakebed"

export type Target = "anonymous" | "claimed"
export type Diagnostic = { path?: string; file?: string; line?: number; message: string }
export type BuildResult = { ok: true; envelope: Envelope } | { ok: false; diagnostics: Diagnostic[] }
export type Builder = (files: Record<string, string>, target: Target) => Promise<BuildResult>

export type AppSummary = { name: string; url: string; claimed: boolean; expiresAt: string | null; updatedAt: number }
export type DeployOutcome =
  | { ok: true; app: AppSummary; changed: boolean }
  | { ok: false; diagnostics: Diagnostic[] }
  | { ok: false; error: string }
export type CallResult = { status: number; body: string }

type Secrets = { key: string; claimToken: string }
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

const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/
const KIKO_MODULE = "server/kiko.ts"
const CALL_BODY_CHARS = 8_000
const AAD = "apps/secrets"

const summary = (row: Row): AppSummary => ({
  name: row.name,
  url: row.url,
  claimed: row.claimed === 1,
  expiresAt: row.expires_at,
  updatedAt: row.updated_at,
})

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

export class Apps {
  constructor(
    private readonly sql: SqlStorage,
    private readonly keyring: Keyring,
    private readonly ownerId: string,
    private readonly build: Builder,
    private readonly egress: typeof fetch,
  ) {}

  list(): AppSummary[] {
    return this.sql.exec<Row>("SELECT * FROM apps ORDER BY name").toArray().map(summary)
  }

  async deploy(name: string, files: Record<string, string>): Promise<DeployOutcome> {
    if (!APP_NAME.test(name)) return { ok: false, error: "name apps with 3-40 lowercase letters, digits or dashes" }
    const row = this.row(name)
    const status = row ? await deployStatus(this.egress, row.deploy_id) : "gone"
    const secrets = row && status !== "gone" ? await this.secrets(row) : null
    const key = secrets?.key ?? toHex(crypto.getRandomValues(new Uint8Array(24)))
    const target: Target = status !== "gone" && status.claimed ? "claimed" : "anonymous"
    const built = await this.build({ ...files, [KIKO_MODULE]: kikoModule(await sha256Hex(key)) }, target)
    if (!built.ok) return { ok: false, diagnostics: built.diagnostics }
    if (row && secrets && row.artifact_hash === built.envelope.artifactHash)
      return { ok: true, app: summary(row), changed: false }
    try {
      const updated =
        row && secrets ? await updateDeploy(this.egress, row.deploy_id, secrets.claimToken, built.envelope) : "gone"
      const result = updated === "gone" ? await createDeploy(this.egress, built.envelope) : updated
      const claimToken = result.claimToken ?? secrets?.claimToken
      if (!claimToken) return { ok: false, error: "Lakebed did not return a claim token for this deploy." }
      return {
        ok: true,
        app: await this.save(name, result, built.envelope.artifactHash, { key, claimToken }),
        changed: true,
      }
    } catch (e) {
      if (e instanceof LakebedError) return { ok: false, error: e.message }
      throw e
    }
  }

  async logs(name: string): Promise<string> {
    const { row, secrets } = await this.require(name)
    return inspect(this.egress, row.url, secrets.claimToken, "/__lakebed/logs")
  }

  async db(name: string): Promise<string> {
    const { row, secrets } = await this.require(name)
    return inspect(this.egress, row.url, secrets.claimToken, "/__lakebed/db")
  }

  async call(name: string, method: string, path: string, body: string | undefined): Promise<CallResult> {
    const { row, secrets } = await this.require(name)
    const headers: Record<string, string> = { "x-kiko-key": secrets.key }
    if (body !== undefined) headers["content-type"] = "application/json"
    const response = await this.egress(new URL(path, row.url).toString(), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    })
    const text = await response.text()
    return {
      status: response.status,
      body: text.length > CALL_BODY_CHARS ? `${text.slice(0, CALL_BODY_CHARS)}…` : text,
    }
  }

  async claimLink(name: string): Promise<string> {
    const { row, secrets } = await this.require(name)
    return claimUrl(row.deploy_id, secrets.claimToken)
  }

  private row(name: string): Row | undefined {
    return this.sql.exec<Row>("SELECT * FROM apps WHERE name = ?", name).toArray()[0]
  }

  private async require(name: string): Promise<{ row: Row; secrets: Secrets }> {
    const row = this.row(name)
    if (!row) throw new LakebedError(`no app named ${name}; deploy it first with app_deploy`)
    return { row, secrets: await this.secrets(row) }
  }

  private async secrets(row: Row): Promise<Secrets> {
    const text = await open(this.keyring, this.ownerId, AAD, {
      kekVersion: row.kek_version,
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    })
    return JSON.parse(text) as Secrets
  }

  private async save(name: string, deployed: Deployed, artifactHash: string, secrets: Secrets): Promise<AppSummary> {
    const sealed = await seal(this.keyring, this.ownerId, AAD, JSON.stringify(secrets))
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
