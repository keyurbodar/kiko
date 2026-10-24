import { loadVerifiedRelease, ReleaseRefused } from "@kiko/durable/release-load"
import { buildMetadata, keptBindings, selectMigrations, uploadBody } from "@kiko/durable/release-plan"
import type { ScriptBinding } from "@kiko/durable/cloudflare"
import { type FetchLike, InstallError, cf, isBlocking, json } from "./cf"
import { DEFAULT_SCRIPT, type Grant, type StoredGrant, boundSecrets, firstInstallSecrets, ownScriptName } from "./plan"

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
  codes?: {
    take(code: string): Promise<OAuthTokens | undefined>
    put(code: string, tokens: OAuthTokens): Promise<void>
  }
}

export type OAuthTokens = { accessToken: string; refreshToken?: string }

export type InstallRequest = {
  clerkToken: string
  sub: string
  grant: Grant
  accountId?: string
}
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
  if (!res.ok || !body?.access_token)
    throw new InstallError({
      code: "oauth_failed",
      message: "Cloudflare did not accept the sign-in. Try connecting again.",
      status: 400,
    })
  return { accessToken: body.access_token, ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}) }
}

async function loadRelease(env: InstallEnv, f: FetchLike) {
  try {
    return await loadVerifiedRelease({ baseUrl: env.RELEASE_BASE_URL, publicKey: env.RELEASE_PUBLIC_KEY }, (url) =>
      f(url),
    )
  } catch (e) {
    if (e instanceof ReleaseRefused) throw new InstallError({ code: e.code, message: e.message, status: 502 })
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

async function ownedByCaller(f: FetchLike, backend: string, clerkToken: string): Promise<boolean> {
  try {
    const res = await f(`${backend}/api/auth/clerk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: clerkToken }),
      redirect: "error",
    })
    if (res.status === 403 || res.status === 404) return false
    const body: unknown = await res.json()
    if (
      res.ok &&
      typeof body === "object" &&
      body !== null &&
      "token" in body &&
      typeof body.token === "string" &&
      "user" in body &&
      typeof body.user === "object" &&
      body.user !== null &&
      "id" in body.user &&
      body.user.id === "owner"
    )
      return true
  } catch {}
  throw new InstallError({
    code: "owner_unverified",
    message: "Could not verify this backend's owner. Sign in again and retry when the backend is reachable.",
    status: 409,
  })
}

function blockingOrNull(e: unknown): null {
  if (isBlocking(e)) throw e
  return null
}

const randomLabel = () =>
  `kiko-${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`

async function ensureSubdomain(
  token: string,
  accountId: string,
  f: FetchLike,
  label = randomLabel,
): Promise<{ subdomain: string; made: boolean }> {
  const path = `/accounts/${accountId}/workers/subdomain`
  const sub = await cf<{ subdomain?: string } | null>(token, path, {}, f).catch(blockingOrNull)
  if (sub?.subdomain) return { subdomain: sub.subdomain, made: false }
  for (let i = 0; i < 3; i++) {
    const made = await cf<{ subdomain?: string } | null>(token, path, json({ subdomain: label() }, "PUT"), f).catch(
      blockingOrNull,
    )
    if (made?.subdomain) return { subdomain: made.subdomain, made: true }
  }
  throw new InstallError({
    code: "no_subdomain",
    message: "Open Workers once in your Cloudflare dashboard to create your workers.dev address, then try again.",
    status: 409,
  })
}

type Account = { id: string; name?: string }

async function pickAccount(
  token: string,
  accounts: Account[],
  chosen: string | undefined,
  ours: string[],
  clerkToken: string,
  f: FetchLike,
): Promise<{ accountId: string; scripts: Script[] }> {
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
  if (usable.length === 1) return pick(usable[0] as (typeof usable)[number])
  for (const name of [...ours, DEFAULT_SCRIPT]) {
    for (const u of usable) {
      if (!u.scripts.some((s) => s.id === name)) continue
      const address = await cf<{ subdomain?: string } | null>(
        token,
        `/accounts/${u.account.id}/workers/subdomain`,
        {},
        f,
      )
      if (
        address?.subdomain &&
        (await ownedByCaller(f, `https://${name}.${address.subdomain}.workers.dev`, clerkToken))
      )
        return pick(u)
    }
  }
  if (usable.length > 1) {
    throw new InstallError({
      code: "choose_account",
      message: "This sign-in can use more than one Cloudflare account. Pick the one Kiko goes in.",
      status: 409,
      cfCodes: [],
      detail: undefined,
      accounts: usable.map((u) => ({ id: u.account.id, name: u.account.name ?? u.account.id })),
    })
  }
  throw (
    first ??
    new InstallError({ code: "no_account", message: "No Cloudflare account was found for this sign-in.", status: 400 })
  )
}

const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]
const DNS_LIMIT_MS = 90_000

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
  let oauth: { code: string; tokens: OAuthTokens } | null = null
  if (req.grant.kind === "oauth") {
    oauth = {
      code: req.grant.code,
      tokens: (await deps.codes?.take(req.grant.code)) ?? (await exchange(env, req.grant, f)),
    }
    const { tokens } = oauth
    token = tokens.accessToken
    stored = {
      kind: "oauth",
      clientId: env.CF_OAUTH_CLIENT_ID,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }
  } else {
    token = req.grant.token
    stored = { kind: "token", token }
  }

  const accounts = await cf<Account[]>(token, "/accounts", {}, f).catch((e: unknown) => {
    if (req.grant.kind === "oauth" && e instanceof InstallError && e.code === "bad_token") {
      throw new InstallError({
        code: "oauth_failed",
        message: "Cloudflare did not accept the sign-in. Try connecting again.",
        status: 400,
        cfCodes: e.cfCodes,
        detail: e.detail,
      })
    }
    throw e
  })
  if (req.accountId && !accounts.some((a) => a.id === req.accountId)) {
    throw new InstallError({
      code: "no_account",
      message: "No Cloudflare account was found for this sign-in.",
      status: 400,
    })
  }
  const ours = await ownScriptName(req.sub, 32)
  const legacy = await ownScriptName(req.sub)
  const { accountId, scripts } = await pickAccount(
    token,
    accounts,
    req.accountId,
    [ours, legacy],
    req.clerkToken,
    f,
  ).catch(async (e: unknown) => {
    if (oauth && e instanceof InstallError && e.code === "choose_account")
      await deps.codes?.put(oauth.code, oauth.tokens)
    throw e
  })

  const { subdomain, made: freshAddress } = await ensureSubdomain(token, accountId, f)
  const host = (name: string) => `https://${name}.${subdomain}.workers.dev`

  const byName = new Map(scripts.map((s) => [s.id, s]))
  const findScriptName = async () => {
    let name: string | undefined
    for (const candidate of [ours, legacy, DEFAULT_SCRIPT]) {
      if (byName.has(candidate) && (await ownedByCaller(f, host(candidate), req.clerkToken))) {
        name = candidate
        break
      }
    }
    if (!name) {
      if (byName.has(ours))
        throw new InstallError({
          code: "owner_conflict",
          message: "The owner-specific Worker name is already in use. No backend was changed.",
          status: 409,
        })
      name = ours
    }
    return name
  }
  const name = await findScriptName()
  const existing = byName.get(name)

  const { manifest, files } = await loadRelease(env, f)
  const grant: StoredGrant = { ...stored, accountId, scriptName: name }
  if (existing && !existing.migration_tag)
    throw new InstallError({
      code: "migration_unknown",
      message:
        "This backend has no migration tag. Nothing was changed. Export its data and inspect it before replacing it.",
      status: 409,
    })
  let migrations: ReturnType<typeof selectMigrations>
  try {
    migrations = selectMigrations(manifest.migrations, existing ? (existing.migration_tag ?? null) : null)
  } catch (error) {
    throw new InstallError({
      code: "migration_unknown",
      message:
        error instanceof Error
          ? error.message
          : "This release does not know the backend's migration tag. Nothing was changed.",
      status: 409,
    })
  }
  const existingBindings = existing
    ? ((
        await cf<{ bindings?: ScriptBinding[] }>(
          token,
          `/accounts/${accountId}/workers/scripts/${name}/settings`,
          {},
          f,
        )
      ).bindings ?? [])
    : []
  const bound = {
    ownerId: req.sub,
    clerkJwtKey: env.CLERK_JWT_KEY,
    trustedOrigins: env.FRONT_DOOR_ORIGIN,
    releaseBase: env.RELEASE_BASE_URL,
    grant,
  }
  const bindings = existing
    ? keptBindings(existingBindings, [])
    : firstInstallSecrets({ ...bound, random: deps.randomSecret })
  await cf(
    token,
    `/accounts/${accountId}/workers/scripts/${name}`,
    {
      method: "PUT",
      body: uploadBody(manifest, files, buildMetadata(manifest, migrations, bindings)),
    },
    f,
  ).catch((e: unknown) => {
    if (!existing && e instanceof InstallError && e.code === "no_permission") {
      throw new InstallError({
        code: "cannot_create",
        message:
          "This sign-in may change Workers but not create one. Give the token Workers Admin, not Workers Editor, then try again.",
        status: 403,
        cfCodes: e.cfCodes,
        detail: e.detail,
      })
    }
    throw e
  })

  if (existing) {
    for (const s of boundSecrets(bound)) {
      await cf(token, `/accounts/${accountId}/workers/scripts/${name}/secrets`, json(s, "PUT"), f)
    }
  }

  await cf(
    token,
    `/accounts/${accountId}/workers/scripts/${name}/subdomain`,
    json({ enabled: true, previews_enabled: false }),
    f,
  )

  const backendUrl = host(name)
  let waited = 0
  while (!(await isKiko(f, `${backendUrl}/api/version`))) {
    if (waited >= POLL_LIMIT_MS)
      throw new InstallError({
        code: "not_ready",
        message: "The backend was installed but did not answer in time. Try again in a minute.",
        status: 504,
      })
    await deps.sleep(POLL_MS)
    waited += POLL_MS
  }

  if (freshAddress) await awaitDns(new URL(backendUrl).host, f, deps.sleep)

  await deps.setMetadata(req.sub, { backendUrl, accountId, version: manifest.version })
  return { backendUrl, version: manifest.version }
}
