import { loadVerifiedRelease, ReleaseRefused } from "@kiko/durable/release-load"
import { BUCKET, type FilesBinding, buildMetadata, selectMigrations, uploadBody } from "@kiko/durable/release-plan"
import { type FetchLike, InstallError, cf, isBlocking, json } from "./cf"
import { DEFAULT_SCRIPT, type Grant, type StoredGrant, firstInstallSecrets, ownScriptName } from "./plan"

export type InstallEnv = {
  CF_OAUTH_CLIENT_ID: string
  CLERK_JWT_KEY: string
  FRONT_DOOR_ORIGIN: string
  RELEASE_BASE_URL: string
  RELEASE_PUBLIC_KEY: string
}

export type InstallDeps = {
  fetch: FetchLike
  randomSecret: () => string
  sleep: (ms: number) => Promise<void>
  setMetadata: (sub: string, metadata: { backendUrl: string; accountId: string; version: string }) => Promise<void>
}

export type InstallRequest = { sub: string; grant: Grant; accountId?: string }
export type InstallResult = { backendUrl: string; version: string }

type Script = { id: string; migration_tag?: string }

const POLL_MS = 3000
const POLL_LIMIT_MS = 60_000

async function exchange(env: InstallEnv, grant: Extract<Grant, { kind: "oauth" }>, f: FetchLike) {
  const res = await f("https://dash.cloudflare.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: grant.code,
      redirect_uri: grant.redirectUri,
      client_id: env.CF_OAUTH_CLIENT_ID,
      code_verifier: grant.verifier,
    }),
  })
  const body = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string } | null
  if (!res.ok || !body?.access_token) throw new InstallError("oauth_failed", "Cloudflare did not accept the sign-in. Try connecting again.", 400)
  return { accessToken: body.access_token, refreshToken: body.refresh_token }
}

// Fetches the latest release and refuses it unless the signature and every module hash match.
export async function loadRelease(env: InstallEnv, f: FetchLike) {
  try {
    return await loadVerifiedRelease({ baseUrl: env.RELEASE_BASE_URL, publicKey: env.RELEASE_PUBLIC_KEY }, (url) => f(url))
  } catch (e) {
    if (e instanceof ReleaseRefused) throw new InstallError(e.code, e.message, 502)
    throw e
  }
}

async function isKiko(f: FetchLike, url: string): Promise<boolean> {
  try {
    const res = await f(url)
    const body = (await res.json()) as { version?: unknown }
    return res.ok && typeof body.version === "string"
  } catch {
    return false
  }
}

// Files live in R2 when the account has it, and in the Worker's own storage when it does not. R2 on a Free
// account needs a plan that Cloudflare only lets the owner turn on in the dashboard, so no failure here stops
// the install: the Worker reads whether the binding exists.
async function hasBucket(token: string, accountId: string, f: FetchLike): Promise<boolean> {
  try {
    await cf(token, `/accounts/${accountId}/r2/buckets`, json({ name: BUCKET }), f)
    return true
  } catch (e) {
    // 10073 is "Bucket name already exists" (https://developers.cloudflare.com/r2/api/error-codes/).
    return e instanceof InstallError && (e.cfCodes.includes(10073) || /already exists/i.test(e.message))
  }
}

function blockingOrNull(e: unknown): null {
  if (isBlocking(e)) throw e
  return null
}

const randomLabel = () => `kiko-${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`

// A new Cloudflare account has no workers.dev address until someone opens Workers in the dashboard, so make one.
async function ensureSubdomain(token: string, accountId: string, f: FetchLike, label = randomLabel): Promise<string> {
  const path = `/accounts/${accountId}/workers/subdomain`
  const sub = await cf<{ subdomain?: string } | null>(token, path, {}, f).catch(blockingOrNull)
  if (sub?.subdomain) return sub.subdomain
  for (let i = 0; i < 3; i++) {
    const made = await cf<{ subdomain?: string } | null>(token, path, json({ subdomain: label() }, "PUT"), f).catch(blockingOrNull)
    if (made?.subdomain) return made.subdomain
  }
  throw new InstallError("no_subdomain", "Open Workers once in your Cloudflare dashboard to create your workers.dev address, then try again.", 409)
}

async function pickAccount(token: string, accounts: { id: string }[], f: FetchLike): Promise<{ accountId: string; scripts: Script[] }> {
  let first: unknown = null
  for (const { id } of accounts) {
    try {
      return { accountId: id, scripts: await cf<Script[]>(token, `/accounts/${id}/workers/scripts`, {}, f) }
    } catch (e) {
      first ??= e
    }
  }
  throw first ?? new InstallError("no_account", "No Cloudflare account was found for this sign-in.", 400)
}

export async function runInstall(env: InstallEnv, deps: InstallDeps, req: InstallRequest): Promise<InstallResult> {
  const f = deps.fetch
  let stored: Omit<StoredGrant, "accountId" | "scriptName">
  let token: string
  if (req.grant.kind === "oauth") {
    const tokens = await exchange(env, req.grant, f)
    token = tokens.accessToken
    stored = { kind: "oauth", clientId: env.CF_OAUTH_CLIENT_ID, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
  } else {
    token = req.grant.token
    stored = { kind: "token", token }
  }

  const accounts = await cf<{ id: string }[]>(token, "/accounts", {}, f)
  if (req.accountId && !accounts.some((a) => a.id === req.accountId)) {
    throw new InstallError("no_account", "No Cloudflare account was found for this sign-in.", 400)
  }
  // A sign-in can list accounts where the person may not change Workers. Use the first that lets us list them.
  const { accountId, scripts } = await pickAccount(token, req.accountId ? accounts.filter((a) => a.id === req.accountId) : accounts, f)

  const subdomain = await ensureSubdomain(token, accountId, f)
  const host = (name: string) => `https://${name}.${subdomain}.workers.dev`

  const byName = new Map(scripts.map((s) => [s.id, s]))
  const ours = await ownScriptName(req.sub)
  let name = DEFAULT_SCRIPT
  if (byName.has(DEFAULT_SCRIPT) && !(await isKiko(f, `${host(DEFAULT_SCRIPT)}/api/version`))) name = ours
  const existing = byName.get(name)
  const fileStore: FilesBinding = existing ? "inherit" : (await hasBucket(token, accountId, f)) ? "r2" : "none"

  const { manifest, files } = await loadRelease(env, f)
  const grant: StoredGrant = { ...stored, accountId, scriptName: name }
  const migrations = selectMigrations(manifest.migrations, existing ? (existing.migration_tag ?? null) : null)
  const secrets = existing
    ? null
    : firstInstallSecrets({
        random: deps.randomSecret,
        ownerId: req.sub,
        clerkJwtKey: env.CLERK_JWT_KEY,
        trustedOrigins: env.FRONT_DOOR_ORIGIN,
        grant,
      })
  await cf(token, `/accounts/${accountId}/workers/scripts/${name}`, { method: "PUT", body: uploadBody(manifest, files, buildMetadata(manifest, migrations, secrets, fileStore)) }, f)

  if (existing) {
    for (const [secretName, text] of [
      ["OWNER_ID", req.sub],
      ["CF_GRANT", JSON.stringify(grant)],
    ] as const) {
      await cf(token, `/accounts/${accountId}/workers/scripts/${name}/secrets`, json({ name: secretName, text, type: "secret_text" }, "PUT"), f)
    }
  }

  await cf(token, `/accounts/${accountId}/workers/scripts/${name}/subdomain`, json({ enabled: true, previews_enabled: false }), f)

  const backendUrl = host(name)
  let waited = 0
  while (!(await isKiko(f, `${backendUrl}/api/version`))) {
    if (waited >= POLL_LIMIT_MS) throw new InstallError("not_ready", "The backend was installed but did not answer in time. Try again in a minute.", 504)
    await deps.sleep(POLL_MS)
    waited += POLL_MS
  }

  await deps.setMetadata(req.sub, { backendUrl, accountId, version: manifest.version })
  return { backendUrl, version: manifest.version }
}
