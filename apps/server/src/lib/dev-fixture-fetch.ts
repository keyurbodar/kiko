import type { Fetcher } from "@yuki/durable/safe-fetch"
import { DEV } from "./dev-guard"

// check-rules: allow egress dev-only transport under safeRequest, which checks the host before it calls this fetcher
const network: Fetcher = (url, init) => fetch(url, init)

export const devFixtureFetcher: Fetcher = async (url, init) => {
  const target = new URL(url)
  if (target.hostname === "cloudflare-dns.com") {
    const name = target.searchParams.get("name") ?? ""
    if (!/^fixture-\d+\.preview\.test$/.test(name)) return network(url, init)
    const a = target.searchParams.get("type") === "A"
    return Response.json({ Status: 0, Answer: a ? [{ name, type: 1, data: "93.184.216.34" }] : [] })
  }
  const match = /^fixture-(\d+)\.preview\.test$/.exec(target.hostname)
  if (!match) return network(url, init)
  return network(`http://localhost:${match[1]}${target.pathname}${target.search}`, init)
}

export const defaultFetcher = (): Fetcher | undefined =>
  DEV ? devFixtureFetcher : undefined
