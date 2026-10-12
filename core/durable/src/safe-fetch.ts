// Known limit: the runtime resolves the host again when it connects, and a Worker
// cannot pin the address it checked. A DNS record that changes between the check
// and the connection is not caught here.

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 3000
const MAX_BYTES = 1024 * 1024
const DOH_URL = "https://cloudflare-dns.com/dns-query"
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export type SafeFetchRefusal =
  | "invalid-url"
  | "scheme"
  | "ip-literal"
  | "blocked-host"
  | "blocked-address"
  | "dns-failed"
  | "too-many-redirects"
  | "timeout"
  | "fetch-failed"

export type SafeFetchResult =
  | {
      ok: true
      url: string
      status: number
      headers: Headers
      body: Uint8Array
      truncated: boolean
    }
  | {
      ok: false
      reason: SafeFetchRefusal
      url: string
    }

type Refusal = Extract<SafeFetchResult, { ok: false }>

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const globalFetcher: Fetcher = (url, init) => fetch(url, init)

export type SafeFetchOptions = {
  maxBytes?: number
  userAgent?: string
  timeoutMs?: number
  dnsCache?: boolean
}

export async function safeFetch(
  rawUrl: string,
  fetcher: Fetcher = globalFetcher,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)
  try {
    return await follow(rawUrl, fetcher, signal, options)
  } catch {
    return refuse(signal.aborted ? "timeout" : "fetch-failed", rawUrl)
  }
}

async function follow(
  rawUrl: string,
  fetcher: Fetcher,
  signal: AbortSignal,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  let next = rawUrl
  let base: URL | undefined
  for (let redirects = 0; ; redirects++) {
    const url = await check(next, base, fetcher, signal, cacheFor(fetcher, options))
    if (!(url instanceof URL)) return url

    const headers: Record<string, string> = { accept: "*/*" }
    if (options.userAgent) headers["user-agent"] = options.userAgent
    const response = await untilAbort(
      fetcher(url.href, { method: "GET", redirect: "manual", headers, signal }),
      signal,
    )
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null
    if (location === null) return read(response, url, signal, options)

    discard(response.body?.cancel())
    if (redirects === MAX_REDIRECTS) return refuse("too-many-redirects", url.href)
    next = location
    base = url
  }
}

export type SafeRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  headers: Record<string, string>
  body?: string
}

export async function safeRequest(rawUrl: string, request: SafeRequest, fetcher: Fetcher = globalFetcher, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)
  try {
    const url = await check(rawUrl, undefined, fetcher, signal, cacheFor(fetcher, options))
    if (!(url instanceof URL)) return url
    if (url.protocol !== "https:") return refuse("scheme", url.href)
    const headers: Record<string, string> = { accept: "*/*", ...request.headers }
    if (options.userAgent) headers["user-agent"] = options.userAgent
    const response = await untilAbort(fetcher(url.href, { method: request.method, redirect: "manual", headers, body: request.body, signal }), signal)
    return read(response, url, signal, options)
  } catch {
    return refuse(signal.aborted ? "timeout" : "fetch-failed", rawUrl)
  }
}

async function check(
  raw: string,
  base: URL | undefined,
  fetcher: Fetcher,
  signal: AbortSignal,
  cached = false,
): Promise<URL | Refusal> {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return refuse("invalid-url", raw)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return refuse("scheme", url.href)
  url.username = ""
  url.password = ""

  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (isIpLiteral(host)) return refuse("ip-literal", url.href)
  // A public name has a dot. This also stops `localhost`, which the runtime may resolve by itself.
  if (!host.includes(".") || host.endsWith(".localhost")) return refuse("blocked-host", url.href)

  const addresses = await resolve(host, fetcher, signal, cached)
  if (addresses === null || addresses.length === 0) return refuse("dns-failed", url.href)
  if (!addresses.every(isPublicAddress)) return refuse("blocked-address", url.href)
  return url
}

async function read(
  response: Response,
  url: URL,
  signal: AbortSignal,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const max = options.maxBytes ?? MAX_BYTES
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  while (reader && size <= max) {
    const { done, value } = await untilAbort(reader.read(), signal)
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  const truncated = size > max
  if (truncated) discard(reader?.cancel())

  const body = new Uint8Array(Math.min(size, max))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= max) break
    body.set(chunk.subarray(0, max - offset), offset)
    offset += chunk.byteLength
  }
  return { ok: true, url: url.href, status: response.status, headers: response.headers, body, truncated }
}

const RECORD_TYPES = { A: 1, AAAA: 28 } as const
const NOERROR = 0
const NXDOMAIN = 3

// A Free Worker invocation has 50 subrequests and each lookup costs two, so answers are cached for their TTL.
const DNS_CACHE = new WeakMap<Fetcher, Map<string, { addresses: string[]; until: number }>>()
const cacheFor = (fetcher: Fetcher, options: SafeFetchOptions) => options.dnsCache ?? fetcher === globalFetcher
const DNS_MIN_TTL_S = 30
const DNS_MAX_TTL_S = 300
const DNS_MAX_HOSTS = 500

async function resolve(host: string, fetcher: Fetcher, signal: AbortSignal, cached: boolean): Promise<string[] | null> {
  let cache = cached ? DNS_CACHE.get(fetcher) : undefined
  if (cached && !cache) {
    cache = new Map()
    DNS_CACHE.set(fetcher, cache)
  }
  const hit = cache?.get(host)
  if (hit && hit.until > Date.now()) return hit.addresses
  let ttl = DNS_MAX_TTL_S
  const lookups = Object.entries(RECORD_TYPES).map(async ([name, type]) => {
    const response = await untilAbort(
      fetcher(`${DOH_URL}?name=${encodeURIComponent(host)}&type=${name}`, {
        headers: { accept: "application/dns-json" },
        signal,
      }),
      signal,
    )
    if (!response.ok) return null
    const answer: unknown = await untilAbort(response.json().catch(() => null), signal)
    if (!isRecord(answer)) return null
    if (answer.Status === NXDOMAIN) return []
    if (answer.Status !== NOERROR) return null
    const records: unknown[] = Array.isArray(answer.Answer) ? answer.Answer : []
    // A CNAME record is skipped. The resolver also returns the addresses at the end of the chain.
    return records.flatMap((record) => {
      if (!isRecord(record) || record.type !== type || typeof record.data !== "string") return []
      if (typeof record.TTL === "number") ttl = Math.min(ttl, record.TTL)
      return [record.data]
    })
  })
  const found = await Promise.all(lookups)
  if (found.some((addresses) => addresses === null)) return null
  const addresses = found.flatMap((a) => a ?? [])
  if (cache && addresses.length) {
    if (cache.size >= DNS_MAX_HOSTS) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(host, { addresses, until: Date.now() + Math.max(DNS_MIN_TTL_S, Math.min(ttl, DNS_MAX_TTL_S)) * 1000 })
  }
  return addresses
}

function isIpLiteral(host: string): boolean {
  if (host.startsWith("[")) return true
  const lastLabel = host.slice(host.lastIndexOf(".") + 1)
  // A host whose last label is a number is an IPv4 address to every URL parser.
  return /^(\d+|0x[0-9a-f]*)$/.test(lastLabel)
}

const BLOCKED_IPV4: ReadonlyArray<readonly [network: string, bits: number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
]

function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4 !== null) {
    return !BLOCKED_IPV4.some(([network, bits]) => {
      const shift = 32 - bits
      const net = parseIpv4(network)
      return net === null || v4 >>> shift === net >>> shift
    })
  }
  const v6 = parseIpv6(address)
  if (v6 === null) return false
  const [first, second] = v6
  if ((first & 0xe000) !== 0x2000) return false
  if (first === 0x2001 && second < 0x200) return false
  if (first === 0x2001 && second === 0x0db8) return false
  if (first === 0x2002) return false
  return true
}

function parseIpv4(text: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return octets.reduce((sum, octet) => sum * 256 + octet, 0)
}

function parseIpv6(text: string): number[] | null {
  const halves = text.split("::")
  if (halves.length > 2) return null
  const groups = halves.map((half) => (half === "" ? [] : half.split(":")))
  const head = groups[0]
  const tail = groups[1] ?? []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const all = [...head, ...Array<string>(missing).fill("0"), ...tail]
  if (!all.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null
  return all.map((group) => parseInt(group, 16))
}

function refuse(reason: SafeFetchRefusal, url: string): Refusal {
  return { ok: false, reason, url }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    work.then(resolve, reject)
  })
}

function discard(work: Promise<void> | undefined): void {
  work?.catch(() => {})
}
