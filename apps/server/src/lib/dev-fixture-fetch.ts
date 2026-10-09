import type { Fetcher } from "./safe-fetch"

declare const process: { env: { NODE_ENV?: string } }

/**
 * Development only. A host named `fixture-<port>.preview.test` resolves to a public address
 * and fetches from `http://localhost:<port>`, so a verify suite can serve a page without a
 * public host. Every request still goes through `safeFetch`.
 */
export const devFixtureFetcher: Fetcher = async (url, init) => {
  const target = new URL(url)
  if (target.hostname === "cloudflare-dns.com") {
    const name = target.searchParams.get("name") ?? ""
    // Only fixture names are answered here. Every other name asks the real resolver, so a dev
    // server fetches real sites the way production does.
    if (!/^fixture-\d+\.preview\.test$/.test(name)) return fetch(url, init)
    const a = target.searchParams.get("type") === "A"
    return Response.json({ Status: 0, Answer: a ? [{ name, type: 1, data: "93.184.216.34" }] : [] })
  }
  const match = /^fixture-(\d+)\.preview\.test$/.exec(target.hostname)
  if (!match) return fetch(url, init)
  return fetch(`http://localhost:${match[1]}${target.pathname}${target.search}`, init)
}

/** The fixture fetcher on a development server, else the platform fetch. */
export const defaultFetcher = (): Fetcher | undefined =>
  process.env.NODE_ENV === "development" ? devFixtureFetcher : undefined
