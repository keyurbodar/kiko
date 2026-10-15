import { loadVerifiedRelease, ReleaseRefused } from "@kiko/durable/release-load"
import { BUCKET, buildMetadata, selectMigrations, uploadBody } from "@kiko/durable/release-plan"
import { type FetchLike, InstallError, cf, json } from "./cf"
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

async function ensureBucket(token: string, accountId: string, f: FetchLike) {
  try {
    await cf(token, `/accounts/${accountId}/r2/buckets`, json({ name: BUCKET }), f)
  } catch (e) {
    if (!(e instanceof InstallError)) throw e
    // UNVERIFIED: Cloudflare error codes 10004 (bucket exists) and 10042 (R2 not enabled).
    if (e.cfCodes.includes(10004) || /already exists/i.test(e.message)) return
    if (e.cfCodes.includes(10042) || /enable R2/i.test(e.message)) {
      throw new InstallError("r2_disabled", "Turn on R2 in your Cloudflare dashboard, then try again.", 409)
    }
    throw e
  }
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
  const accountId = req.accountId ?? accounts[0]?.id
  if (!accountId || !accounts.some((a) => a.id === accountId)) {
    throw new InstallError("no_account", "No Cloudflare account was found for this sign-in.", 400)
  }

  const sub = await cf<{ subdomain?: string } | null>(token, `/accounts/${accountId}/workers/subdomain`, {}, f).catch(() => null)
  if (!sub?.subdomain) {
    throw new InstallError("no_subdomain", "Open Workers once in your Cloudflare dashboard to create your workers.dev address, then try again.", 409)
  }
  const host = (name: string) => `https://${name}.${sub.subdomain}.workers.dev`

  await ensureBucket(token, accountId, f)

  const scripts = await cf<Script[]>(token, `/accounts/${accountId}/workers/scripts`, {}, f)
  const byName = new Map(scripts.map((s) => [s.id, s]))
  const ours = await ownScriptName(req.sub)
  let name = DEFAULT_SCRIPT
  if (byName.has(DEFAULT_SCRIPT) && !(await isKiko(f, `${host(DEFAULT_SCRIPT)}/api/version`))) name = ours
  const existing = byName.get(name)

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
  await cf(token, `/accounts/${accountId}/workers/scripts/${name}`, { method: "PUT", body: uploadBody(manifest, files, buildMetadata(manifest, migrations, secrets)) }, f)

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
