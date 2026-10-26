const LAKEBED_API = "https://api.lakebed.dev"
const LAKEBED_CLIENT_VERSION = "0.0.41"

export type Envelope = { artifact: unknown; artifactHash: string; clientBundle: string; clientBundleHash: string }

export type Deployed = {
  deployId: string
  url: string
  claimed: boolean
  expiresAt: string | null
  claimToken: string | null
}

export class LakebedError extends Error {}

type DeployBody = {
  deployId?: string
  url?: string
  claimed?: boolean
  expiresAt?: string
  claimUrl?: string
  error?: string
}

function claimTokenOf(body: DeployBody): string | null {
  if (!body.claimUrl || !body.deployId) return null
  const segments = new URL(body.claimUrl).pathname.split("/").filter(Boolean)
  return segments[0] === "claim" && segments[1] === body.deployId ? (segments[2] ?? null) : null
}

async function read(response: Response, what: string): Promise<DeployBody> {
  const body = (await response.json().catch(() => null)) as DeployBody | null
  if (!response.ok || !body)
    throw new LakebedError(`${what} failed (${response.status}): ${body?.error ?? "no details"}`)
  return body
}

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

const payload = (envelope: Envelope) =>
  JSON.stringify({
    artifact: envelope.artifact,
    clientBundle: envelope.clientBundle,
    clientVersion: LAKEBED_CLIENT_VERSION,
  })

export async function createDeploy(fetcher: typeof fetch, envelope: Envelope): Promise<Deployed> {
  const response = await fetcher(`${LAKEBED_API}/v1/anonymous-deploys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload(envelope),
  })
  return deployed(await read(response, "Creating the Lakebed deploy"), null)
}

export async function updateDeploy(
  fetcher: typeof fetch,
  deployId: string,
  claimToken: string,
  envelope: Envelope,
): Promise<Deployed | "gone"> {
  const response = await fetcher(`${LAKEBED_API}/v1/deploys/${encodeURIComponent(deployId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${claimToken}` },
    body: payload(envelope),
  })
  if (response.status === 404 || response.status === 410) return "gone"
  return deployed(await read(response, "Updating the Lakebed deploy"), claimToken)
}

export async function deployStatus(fetcher: typeof fetch, deployId: string): Promise<{ claimed: boolean } | "gone"> {
  const response = await fetcher(`${LAKEBED_API}/v1/deploys/${encodeURIComponent(deployId)}`)
  if (response.status === 404 || response.status === 410) return "gone"
  const body = await read(response, "Reading the Lakebed deploy")
  return { claimed: Boolean(body.claimed) }
}

export async function inspect(fetcher: typeof fetch, url: string, claimToken: string, path: string): Promise<string> {
  const response = await fetcher(`${url}${path}`, { headers: { Authorization: `Bearer ${claimToken}` } })
  const text = await response.text()
  if (!response.ok) throw new LakebedError(`Lakebed ${path} answered ${response.status}: ${text.slice(0, 300)}`)
  return text
}

export function claimUrl(deployId: string, claimToken: string): string {
  return `https://dashboard.lakebed.dev/claim/${encodeURIComponent(deployId)}/${encodeURIComponent(claimToken)}`
}
