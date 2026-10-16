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
  /** Tokens an OAuth code was already traded for. A code works once, and picking an account sends it again. */
  codes?: { get(code: string): Promise<OAuthTokens | undefined>; put(code: string, tokens: OAuthTokens): Promise<void> }
}

export type OAuthTokens = { accessToken: string; refreshToken?: string }

export type InstallRequest = { sub: string; grant: Grant; accountId?: string }
export type InstallResult = { backendUrl: string; version: string }

type Script = { id: string; migration_tag?: string }

const POLL_MS = 3000
const POLL_LIMIT_MS = 60_000

async function exchange(env: InstallEnv, grant: Extract<Grant, { kind: "oauth" }>, f: FetchLike): Promise<OAuthTokens> {
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
  return { accessToken: body.access_token, ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}) }
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
    // 10073 is "Bucket name already exists" (https://developers.cloudflare.com/r2/api/error-codes/). A live account
    // answers 10004 "The bucket you tried to create already exists, and you own it."
    return e instanceof InstallError && (e.cfCodes.includes(10073) || e.cfCodes.includes(10004) || /already exists/i.test(e.detail ?? ""))
  }
}

function blockingOrNull(e: unknown): null {
  if (isBlocking(e)) throw e
  return null
}

const randomLabel = () => `kiko-${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`

// A new Cloudflare account has no workers.dev address until someone opens Workers in the dashboard, so make one.
async function ensureSubdomain(token: string, accountId: string, f: FetchLike, label = randomLabel): Promise<{ subdomain: string; made: boolean }> {
  const path = `/accounts/${accountId}/workers/subdomain`
  const sub = await cf<{ subdomain?: string } | null>(token, path, {}, f).catch(blockingOrNull)
  if (sub?.subdomain) return { subdomain: sub.subdomain, made: false }
  for (let i = 0; i < 3; i++) {
    const made = await cf<{ subdomain?: string } | null>(token, path, json({ subdomain: label() }, "PUT"), f).catch(blockingOrNull)
    if (made?.subdomain) return { subdomain: made.subdomain, made: true }
  }
  throw new InstallError("no_subdomain", "Open Workers once in your Cloudflare dashboard to create your workers.dev address, then try again.", 409)
}

type Account = { id: string; name?: string }

/**
 * The account to install into. One that already runs Kiko wins, so a reinstall never lands in a second account.
 * With one usable account it is that one. With several and none chosen, the person picks: taking the first one
 * that answered could be a team account where they may list Workers but not create one.
 */
async function pickAccount(token: string, accounts: Account[], chosen: string | undefined, ours: string, f: FetchLike): Promise<{ accountId: string; scripts: Script[] }> {
  let first: unknown = null
  const usable: { account: Account; scripts: Script[] }[] = []
  for (const account of chosen ? accounts.filter((a) => a.id === chosen) : accounts) {
    try {
      usable.push({ account, scripts: await cf<Script[]>(token, `/accounts/${account.id}/workers/scripts`, {}, f) })
    } catch (e) {
      if (isBlocking(e) && !(e instanceof InstallError && e.code === "no_permission")) throw e
      first ??= e
    }
  }
  const pick = (u: { account: Account; scripts: Script[] }) => ({ accountId: u.account.id, scripts: u.scripts })
  const running = usable.find((u) => u.scripts.some((s) => s.id === DEFAULT_SCRIPT || s.id === ours))
  if (running) return pick(running)
  if (usable.length === 1) return pick(usable[0] as (typeof usable)[number])
  if (usable.length > 1) {
    throw new InstallError("choose_account", "This sign-in can use more than one Cloudflare account. Pick the one Kiko goes in.", 409, [], undefined, usable.map((u) => ({ id: u.account.id, name: u.account.name ?? u.account.id })))
  }
  throw first ?? new InstallError("no_account", "No Cloudflare account was found for this sign-in.", 400)
}

/** Public resolvers that must see a fresh workers.dev address before a phone or laptop is sent to it. */
const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]
const DNS_LIMIT_MS = 90_000

// A workers.dev address made a moment ago answers inside Cloudflare at once, but a resolver that looks it up before
// it is published caches "no such name" for minutes. Waiting until public resolvers see it keeps the browser's first
// lookup from being that one.
async function awaitDns(host: string, f: FetchLike, sleep: (ms: number) => Promise<void>): Promise<void> {
  const seen = async (resolver: string) => {
    try {
      const res = await f(`${resolver}?name=${host}&type=A`, { headers: { accept: "application/dns-json" } })
      const body = (await res.json()) as { Status?: number; Answer?: unknown[] }
      return body.Status === 0 && (body.Answer?.length ?? 0) > 0
    } catch {
      return false
    }
  }
  for (let waited = 0; waited < DNS_LIMIT_MS; waited += POLL_MS) {
    if ((await Promise.all(RESOLVERS.map(seen))).every(Boolean)) return
    await sleep(POLL_MS)
  }
}

export async function runInstall(env: InstallEnv, deps: InstallDeps, req: InstallRequest): Promise<InstallResult> {
  const f = deps.fetch
  let stored: Omit<StoredGrant, "accountId" | "scriptName">
  let token: string
  if (req.grant.kind === "oauth") {
    const known = await deps.codes?.get(req.grant.code)
    const tokens = known ?? (await exchange(env, req.grant, f))
    if (!known) await deps.codes?.put(req.grant.code, tokens)
    token = tokens.accessToken
    stored = { kind: "oauth", clientId: env.CF_OAUTH_CLIENT_ID, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
  } else {
    token = req.grant.token
    stored = { kind: "token", token }
  }

  const accounts = await cf<Account[]>(token, "/accounts", {}, f)
  if (req.accountId && !accounts.some((a) => a.id === req.accountId)) {
    throw new InstallError("no_account", "No Cloudflare account was found for this sign-in.", 400)
  }
  const ours = await ownScriptName(req.sub)
  const { accountId, scripts } = await pickAccount(token, accounts, req.accountId, ours, f)

  const { subdomain, made: freshAddress } = await ensureSubdomain(token, accountId, f)
  const host = (name: string) => `https://${name}.${subdomain}.workers.dev`

  const byName = new Map(scripts.map((s) => [s.id, s]))
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
  await cf(token, `/accounts/${accountId}/workers/scripts/${name}`, { method: "PUT", body: uploadBody(manifest, files, buildMetadata(manifest, migrations, secrets, fileStore)) }, f).catch((e: unknown) => {
    // Since Cloudflare's Workers roles (2026-09), Workers Editor may change a Worker but not create one.
    if (!existing && e instanceof InstallError && e.code === "no_permission") {
      throw new InstallError("cannot_create", "This sign-in may change Workers but not create one. Give the token Workers Admin, not Workers Editor, then try again.", 403, e.cfCodes, e.detail)
    }
    throw e
  })

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

  if (freshAddress) await awaitDns(new URL(backendUrl).host, f, deps.sleep)

  await deps.setMetadata(req.sub, { backendUrl, accountId, version: manifest.version })
  return { backendUrl, version: manifest.version }
}
