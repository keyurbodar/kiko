// The one function that fetches a URL someone else chose. Architecture section 18.2.
//
// Every module that fetches a user-supplied or model-supplied URL calls safeFetch.
// Nothing else in the server may call fetch on such a URL.
//
// Known limit: the runtime resolves the host again when it connects, and a Worker
// cannot pin the address it checked. A DNS record that changes between the check
// and the connection is not caught here.

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 3000
// ASSUMPTION: 1 MB means 1024 * 1024 bytes, counted after decompression.
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
      /** The URL that answered, after redirects. */
      url: string
      status: number
      headers: Headers
      /** At most `maxBytes`, 1 MB by default. ASSUMPTION: a longer body is cut, not refused. */
      body: Uint8Array
      /** True when the body was cut at `maxBytes` or `stop` ended the read early. */
      truncated: boolean
    }
  | {
      ok: false
      reason: SafeFetchRefusal
      /** The URL that was refused. After a redirect it is the hop that failed, not the first URL. */
      url: string
    }

type Refusal = Extract<SafeFetchResult, { ok: false }>

/** The part of `fetch` this module uses. Tests pass their own. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const globalFetcher: Fetcher = (url, init) => fetch(url, init)

export type SafeFetchOptions = {
  /** The most bytes kept. Defaults to 1 MB. */
  maxBytes?: number
  /**
   * Called with each chunk as it arrives. Returning true keeps what was read and cancels the rest,
   * so a preview reads a page's head and never downloads its body.
   */
  stop?: (chunk: Uint8Array) => boolean
  /** Sent as `user-agent`. The only header a caller may choose. */
  userAgent?: string
  /** The one deadline for DNS, every hop, and the body. Defaults to 3 seconds. */
  timeoutMs?: number
}

export async function safeFetch(
  rawUrl: string,
  fetcher: Fetcher = globalFetcher,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  // One deadline covers DNS, every hop, and the body.
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
    const url = await check(next, base, fetcher, signal)
    if (!(url instanceof URL)) return url

    // No cookie and no authorization header: the caller chooses only the user agent,
    // check() strips the user and password, and nothing carries state between hops.
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

/** Returns the URL to fetch, or the reason it must not be fetched. */
async function check(
  raw: string,
  base: URL | undefined,
  fetcher: Fetcher,
  signal: AbortSignal,
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

  // The URL parser has already turned decimal, hex, octal, and short forms into dotted form.
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (isIpLiteral(host)) return refuse("ip-literal", url.href)
  // A public name has a dot. This also stops `localhost`, which the runtime may resolve by itself.
  if (!host.includes(".") || host.endsWith(".localhost")) return refuse("blocked-host", url.href)

  const addresses = await resolve(host, fetcher, signal)
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
  let stopped = false
  const reader = response.body?.getReader()
  while (reader && size <= max) {
    const { done, value } = await untilAbort(reader.read(), signal)
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (options.stop?.(value)) {
      stopped = true
      break
    }
  }
  const truncated = stopped || size > max
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

// DNS over HTTPS, Cloudflare's JSON API.
// https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/

const RECORD_TYPES = { A: 1, AAAA: 28 } as const
const NOERROR = 0
const NXDOMAIN = 3

/** Every A and AAAA address of the host. Null when either lookup fails, so the caller refuses. */
async function resolve(host: string, fetcher: Fetcher, signal: AbortSignal): Promise<string[] | null> {
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
    return records.flatMap((record) =>
      isRecord(record) && record.type === type && typeof record.data === "string" ? [record.data] : [],
    )
  })
  const found = await Promise.all(lookups)
  return found.some((addresses) => addresses === null) ? null : found.flatMap((addresses) => addresses ?? [])
}

// Addresses.

function isIpLiteral(host: string): boolean {
  if (host.startsWith("[")) return true
  const lastLabel = host.slice(host.lastIndexOf(".") + 1)
  // A host whose last label is a number is an IPv4 address to every URL parser.
  return /^(\d+|0x[0-9a-f]*)$/.test(lastLabel)
}

// Each row is a network and its prefix length. An address inside any row is refused.
const BLOCKED_IPV4: ReadonlyArray<readonly [network: string, bits: number]> = [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, and cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 3], // multicast, reserved, and broadcast
]

/** False for anything that is not a plain public unicast address, and for anything unparseable. */
function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4 !== null) {
    return !BLOCKED_IPV4.some(([network, bits]) => {
      const shift = 32 - bits
      return v4 >>> shift === parseIpv4(network)! >>> shift
    })
  }
  const v6 = parseIpv6(address)
  if (v6 === null) return false
  const [first, second] = v6
  // Only global unicast, 2000::/3, is allowed. That refuses loopback, unique local,
  // link-local, multicast, IPv4-mapped, and NAT64 addresses in one test.
  if ((first & 0xe000) !== 0x2000) return false
  if (first === 0x2001 && second < 0x200) return false // 2001::/23, which holds Teredo
  if (first === 0x2001 && second === 0xdb8) return false // documentation
  if (first === 0x2002) return false // 6to4, which wraps an IPv4 address
  return true
}

function parseIpv4(text: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return octets.reduce((sum, octet) => sum * 256 + octet, 0)
}

/** Eight 16-bit groups. A form with a dotted IPv4 tail is not parsed, so it is refused. */
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

// Helpers.

function refuse(reason: SafeFetchRefusal, url: string): Refusal {
  return { ok: false, reason, url }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Rejects when the deadline passes, even if the work itself never settles. */
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    work.then(resolve, reject)
  })
}

/** Cancelling a body is best effort. Its failure changes nothing. */
function discard(work: Promise<void> | undefined): void {
  work?.catch(() => {})
}
