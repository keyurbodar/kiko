import type { Fetcher } from "@yuki/durable/safe-fetch"

declare const process: { env: { NODE_ENV?: string } }

export const devFixtureFetcher: Fetcher = async (url, init) => {
  const target = new URL(url)
  if (target.hostname === "cloudflare-dns.com") {
    const name = target.searchParams.get("name") ?? ""
    if (!/^fixture-\d+\.preview\.test$/.test(name)) return fetch(url, init)
    const a = target.searchParams.get("type") === "A"
    return Response.json({ Status: 0, Answer: a ? [{ name, type: 1, data: "93.184.216.34" }] : [] })
  }
  const match = /^fixture-(\d+)\.preview\.test$/.exec(target.hostname)
  if (!match) return fetch(url, init)
  return fetch(`http://localhost:${match[1]}${target.pathname}${target.search}`, init)
}

export const defaultFetcher = (): Fetcher | undefined =>
  process.env.NODE_ENV === "development" ? devFixtureFetcher : undefined
