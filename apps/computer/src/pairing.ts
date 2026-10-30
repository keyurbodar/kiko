import { generateKeys } from "@kiko/computer/sign"
import type { Config } from "./config"
import { ensurePolicy, loadConfig, saveConfig, saveKey } from "./config"
import { CliError } from "./errors"
import { helloPayload } from "./hello"
import type { Detection } from "./caps"
import { hostName } from "./platform"

export type ParsedTarget = { origin: string; code: string }

function parsePairTarget(target: string): ParsedTarget {
  const hash = target.indexOf("#")
  if (hash < 0)
    throw new CliError({ message: "pair needs the whole URL the web app copied, including the part after #" })
  const code = target.slice(hash + 1).trim()
  if (!code) throw new CliError({ message: "that pairing URL has no code after the #" })
  return { origin: originOf(target.slice(0, hash).trim()), code }
}

function originOf(raw: string): string {
  if (!raw) throw new CliError({ message: "that pairing URL has no worker address" })
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new CliError({ message: `cannot read a worker address from ${raw}` })
  }
  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/pc\/?$/, "")
  return url.toString().replace(/\/$/, "")
}

type Answer = { id: string; name: string; userId: string }

async function postPair(origin: string, body: unknown): Promise<Answer> {
  const url = new URL("api/pc/pair", `${origin}/`)
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new CliError({
      message: `cannot reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
  const parsed = (await response.json().catch(() => null)) as (Answer & { error?: string }) | null
  if (!response.ok) {
    throw new CliError({ message: parsed?.error ?? `pairing failed: ${url.origin} answered ${response.status}` })
  }
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.userId !== "string") {
    throw new CliError({ message: "pairing failed: the worker's answer had no machine id" })
  }
  return parsed
}

export async function pair(dir: string, detection: Detection, target: string, name: string | null): Promise<Config> {
  const { origin, code } = parsePairTarget(target)
  const keys = await generateKeys()
  const label = name ?? hostName()
  const previous = await loadConfig(dir)
  const answer = await postPair(origin, {
    code,
    publicKey: keys.publicKey,
    name: label,
    hello: helloPayload(detection, null),
    ...(previous ? { replaces: previous.pcId } : {}),
  })
  await ensurePolicy(dir)
  await saveKey(dir, keys.privateKey)
  const config: Config = { url: origin, userId: answer.userId, pcId: answer.id, name: answer.name || label }
  await saveConfig(dir, config)
  return config
}
