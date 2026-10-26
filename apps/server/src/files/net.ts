import type { SecureFetch } from "just-bash"

type SecureFetchOptions = NonNullable<Parameters<SecureFetch>[1]>

export type HeaderBroker = (url: URL) => Promise<Record<string, string> | null>

const MAX_REDIRECTS = 10
const MAX_BYTES = 10 * 1024 * 1024
const REDIRECTS = new Set([301, 302, 303, 307, 308])

class NetError extends Error {}

async function capped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new NetError(`the response is over ${MAX_BYTES} bytes`)
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const headersOf = (headers: Headers) => Object.fromEntries(headers.entries())

type Hop = { status: number; statusText: string; headers: Record<string, string> }
type Request = { url: URL; method: string; body: SecureFetchOptions["body"] }

const redirected = (response: Response, options: SecureFetchOptions) =>
  REDIRECTS.has(response.status) && response.headers.get("location") !== null && options.followRedirects !== false

function nextRequest(response: Response, current: Request): Request {
  const url = new URL(response.headers.get("location") as string, current.url)
  const toGet =
    response.status === 303 || ((response.status === 301 || response.status === 302) && current.method === "POST")
  return toGet ? { url, method: "GET", body: undefined } : { ...current, url }
}

export function bashFetch(egress: typeof fetch, broker: HeaderBroker): SecureFetch {
  const send = async (request: Request, options: SecureFetchOptions) => {
    if (request.url.protocol !== "https:")
      throw new NetError(`only https:// urls can be fetched, not ${request.url.protocol}`)
    const sendsBody = request.body !== undefined && request.method !== "GET" && request.method !== "HEAD"
    return egress(request.url.href, {
      method: request.method,
      headers: { ...headersOf(new Headers(options.headers)), ...(await broker(request.url)) },
      ...(sendsBody ? { body: request.body } : {}),
      redirect: "manual",
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }
  return async (input, options = {}) => {
    let request: Request = { url: new URL(input), method: options.method ?? "GET", body: options.body }
    const chain: Hop[] = []
    const limit = Math.min(options.maxRedirects ?? MAX_REDIRECTS, MAX_REDIRECTS)
    for (;;) {
      const response = await send(request, options)
      if (!redirected(response, options))
        return {
          status: response.status,
          statusText: response.statusText,
          headers: headersOf(response.headers),
          body: request.method === "HEAD" ? new Uint8Array() : await capped(response),
          url: request.url.href,
          ...(chain.length ? { redirectChain: chain } : {}),
        }
      if (chain.length >= limit) throw new NetError(`more than ${limit} redirects`)
      await response.body?.cancel()
      chain.push({ status: response.status, statusText: response.statusText, headers: headersOf(response.headers) })
      request = nextRequest(response, request)
    }
  }
}
