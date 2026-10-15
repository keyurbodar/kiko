import { type ReleaseManifest, parseManifest, verifyModuleHash, verifyRelease } from "@kiko/durable/release"
import { type FetchLike, InstallError, cf, json } from "./cf"
import {
  BUCKET,
  DEFAULT_SCRIPT,
  type Grant,
  type StoredGrant,
  buildMetadata,
  firstInstallSecrets,
  ownScriptName,
  selectMigrations,
} from "./plan"

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

async function fetchBytes(f: FetchLike, url: string): Promise<Uint8Array> {
  const res = await f(url)
  if (!res.ok) throw new InstallError("release_unavailable", `The release file ${url.split("/").pop()} could not be fetched.`, 502)
  return new Uint8Array(await res.arrayBuffer())
}

// Fetches the latest release and refuses it unless the signature and every module hash match.
export async function loadRelease(env: InstallEnv, f: FetchLike) {
  const base = env.RELEASE_BASE_URL.replace(/\/$/, "")
  const latest = JSON.parse(new TextDecoder().decode(await fetchBytes(f, `${base}/latest.json`))) as { version: string }
  const dir = `${base}/${latest.version}`
  const manifestBytes = await fetchBytes(f, `${dir}/manifest.json`)
  const signature = new TextDecoder().decode(await fetchBytes(f, `${dir}/manifest.sig`))
  if (!(await verifyRelease(manifestBytes, signature, env.RELEASE_PUBLIC_KEY))) {
    throw new InstallError("release_untrusted", "The release signature is not valid. Nothing was installed.", 502)
  }
  const manifest = parseManifest(manifestBytes)
  if (!manifest) throw new InstallError("release_untrusted", "The release manifest is malformed. Nothing was installed.", 502)
  const files = new Map<string, Uint8Array>()
  for (const module of manifest.modules) {
    const bytes = await fetchBytes(f, `${dir}/${module.name}`)
    if (!(await verifyModuleHash(module, bytes))) {
      throw new InstallError("release_untrusted", `Module ${module.name} does not match the signed manifest. Nothing was installed.`, 502)
    }
    files.set(module.name, bytes)
  }
  return { manifest, files }
}

function uploadBody(manifest: ReleaseManifest, files: Map<string, Uint8Array>, metadata: unknown): FormData {
  const form = new FormData()
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }))
  for (const module of manifest.modules) {
    form.set(module.name, new Blob([files.get(module.name) as Uint8Array<ArrayBuffer>], { type: module.type }), module.name)
  }
  return form
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
  let stored: Omit<StoredGrant, "accountId">
  let token: string
  if (req.grant.kind === "oauth") {
    const tokens = await exchange(env, req.grant, f)
    token = tokens.accessToken
    stored = { kind: "oauth", accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
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
  const grant: StoredGrant = { ...stored, accountId }
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
