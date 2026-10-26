const LAKEBED_API = "https://api.lakebed.dev"

export type Envelope = { artifact: unknown; artifactHash: string; clientBundle: string; clientBundleHash: string }

export type Deployed = {
  deployId: string
  url: string
  claimed: boolean
  expiresAt: string | null
  claimToken: string | null
}

export type DeployRecord = { claimed: boolean; url?: string; access?: string; status?: string }

export type DeployOptions = {
  publicInspect?: boolean
  serverEnv?: Record<string, string>
  deleteTables?: { table: string; rowCount: number }[]
}

export type CliSession = {
  sessionId: string
  pollSecret: string
  code: string
  verificationUrl: string
  expiresAt: string
  intervalSeconds?: number
}

export type Approved = { token: string; login: string | null }

export class LakebedError extends Error {}

type DeployBody = { deployId?: string; url?: string; claimed?: boolean; expiresAt?: string; claimUrl?: string }

const encode = encodeURIComponent

function claimTokenOf(body: DeployBody): string | null {
  if (!body.claimUrl || !body.deployId) return null
  const segments = new URL(body.claimUrl).pathname.split("/").filter(Boolean)
  return segments[0] === "claim" && segments[1] === body.deployId ? (segments[2] ?? null) : null
}

function errorText(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown }
    const said = body.error ?? body.message
    if (typeof said === "string") return said
    if (said && typeof said === "object" && "message" in said) return String((said as { message: unknown }).message)
  } catch {}
  return text.slice(0, 400) || "no details"
}

async function json<T>(response: Response, what: string): Promise<T> {
  const text = await response.text()
  if (!response.ok) throw new LakebedError(`${what} failed (${response.status}): ${errorText(text)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new LakebedError(`${what} answered with something that is not JSON.`)
  }
}

const gone = (response: Response) => response.status === 404 || response.status === 410

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

function deployed(body: DeployBody, claimToken: string | null): Deployed {
  if (!body.deployId || !body.url) throw new LakebedError("Lakebed answered without a deploy id or url.")
  return {
    deployId: body.deployId,
    url: body.url,
    claimed: Boolean(body.claimed),
    expiresAt: body.claimed ? null : (body.expiresAt ?? null),
    claimToken: claimTokenOf(body) ?? claimToken,
  }
}

function lakebedVersion(envelope: Envelope): string {
  const created = (envelope.artifact as { createdWith?: { lakebed?: unknown } } | null)?.createdWith
  if (typeof created?.lakebed !== "string") throw new LakebedError("The build did not say which Lakebed made it.")
  return created.lakebed
}

function payload(envelope: Envelope, options: DeployOptions): string {
  return JSON.stringify({
    artifact: envelope.artifact,
    clientBundle: envelope.clientBundle,
    clientVersion: lakebedVersion(envelope),
    ...(options.deleteTables?.length ? { deleteTables: options.deleteTables } : {}),
    ...(options.publicInspect ? { inspectPolicy: "public" } : {}),
    ...(options.serverEnv ? { serverEnv: { mode: "replace", values: options.serverEnv } } : {}),
  })
}

export class Lakebed {
  constructor(private readonly fetcher: typeof fetch) {}

  private send(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetcher(`${LAKEBED_API}${path}`, init)
  }

  private sendJson(path: string, method: string, token: string, body: unknown): Promise<Response> {
    return this.send(path, {
      method,
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  async create(envelope: Envelope, options: DeployOptions, accountToken: string | null): Promise<Deployed> {
    const response = await this.send(accountToken ? "/v1/deploys" : "/v1/anonymous-deploys", {
      method: "POST",
      headers: { ...(accountToken ? bearer(accountToken) : {}), "Content-Type": "application/json" },
      body: payload(envelope, options),
    })
    return deployed(await json<DeployBody>(response, "Creating the Lakebed deploy"), null)
  }

  async update(
    deployId: string,
    token: string,
    envelope: Envelope,
    options: DeployOptions,
    claimToken: string | null,
  ): Promise<Deployed | "gone"> {
    const response = await this.send(`/v1/deploys/${encode(deployId)}`, {
      method: "PUT",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: payload(envelope, options),
    })
    if (gone(response)) return "gone"
    return deployed(await json<DeployBody>(response, "Updating the Lakebed deploy"), claimToken)
  }

  async record(deployId: string): Promise<DeployRecord | "gone"> {
    const response = await this.send(`/v1/deploys/${encode(deployId)}`)
    if (gone(response)) return "gone"
    const body = await json<DeployRecord>(response, "Reading the Lakebed deploy")
    return { ...body, claimed: Boolean(body.claimed) }
  }

  async inspect(appUrl: string, token: string, path: string): Promise<string> {
    const response = await this.fetcher(`${appUrl}${path}`, { headers: bearer(token) })
    const text = await response.text()
    if (!response.ok)
      throw new LakebedError(`Lakebed ${path.split("?")[0]} answered ${response.status}: ${errorText(text)}`)
    return text
  }

  async startSession(): Promise<CliSession> {
    return json<CliSession>(await this.send("/v1/auth/cli-sessions", { method: "POST" }), "Starting a Lakebed sign-in")
  }

  async exchange(session: CliSession): Promise<Approved | "pending" | "expired"> {
    const response = await this.send(`/v1/auth/cli-sessions/${encode(session.sessionId)}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollSecret: session.pollSecret }),
    })
    if (response.status === 401 || response.status === 410) return "expired"
    const body = await json<{ status?: string; token?: string; user?: { login?: string } }>(
      response,
      "Checking the Lakebed sign-in",
    )
    if (body.status === "approved" && body.token) return { token: body.token, login: body.user?.login ?? null }
    return "pending"
  }

  async deploys(token: string): Promise<unknown> {
    return json(await this.send("/v1/me/deploys", { headers: bearer(token) }), "Listing Lakebed deploys")
  }

  async lifecycle(token: string, deployId: string, action: "archive" | "restore" | "terminate"): Promise<unknown> {
    const response = await this.send(`/v1/me/deploys/${encode(deployId)}/${action}`, {
      method: "POST",
      headers: bearer(token),
    })
    return json(response, `Asking Lakebed to ${action} the deploy`)
  }

  async domains(
    token: string,
    deployId: string,
    action: "add" | "status" | "list" | "remove",
    hostname?: string,
  ): Promise<unknown> {
    const base = `/v1/deploys/${encode(deployId)}/domains`
    if (action === "add") return json(await this.sendJson(base, "POST", token, { hostname }), "Adding the domain")
    if (action === "list") return json(await this.send(base, { headers: bearer(token) }), "Listing domains")
    const path = `${base}/${encode(hostname ?? "")}`
    if (action === "status") return json(await this.send(path, { headers: bearer(token) }), "Reading the domain")
    return json(await this.send(path, { method: "DELETE", headers: bearer(token) }), "Removing the domain")
  }

  async users(
    token: string,
    deployId: string,
    action: "list" | "approve" | "deny" | "remove",
    subject?: string,
  ): Promise<unknown> {
    const path = `/v1/deploys/${encode(deployId)}/users`
    if (action === "list") return json(await this.send(path, { headers: bearer(token) }), "Listing app users")
    return json(await this.sendJson(path, "POST", token, { action, subject }), `Asking Lakebed to ${action} the user`)
  }

  async deleteStored(token: string, deployId: string, key: string): Promise<unknown> {
    const response = await this.send(`/v1/me/deploys/${encode(deployId)}/storage/${key}`, {
      method: "DELETE",
      headers: bearer(token),
    })
    return json(response, "Deleting the stored file")
  }
}

export function claimUrl(deployId: string, claimToken: string, sessionId?: string): string {
  const url = new URL(`${LAKEBED_API}/claim/${encode(deployId)}/${encode(claimToken)}`)
  if (sessionId) url.searchParams.set("cli_session", sessionId)
  return url.href
}
