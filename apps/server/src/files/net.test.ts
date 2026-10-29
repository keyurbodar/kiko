import { describe, expect, it } from "vitest"
import { bashFetch } from "./net"

type Seen = { url: string; method: string; key: string | null; agent: string | null; body: string | null }

const DNS = "https://cloudflare-dns.com/dns-query"

function world(routes: Record<string, () => Response>, dns: Record<string, string> = {}) {
  const seen: Seen[] = []
  const egress = (async (url: string, init: RequestInit) => {
    if (url.startsWith(DNS)) {
      const name = new URL(url).searchParams.get("name") ?? ""
      return Response.json(
        { Status: 0, Answer: [{ type: 1, TTL: 60, data: dns[name] ?? "93.184.216.34" }] },
        { headers: { "content-type": "application/dns-json" } },
      )
    }
    const headers = new Headers(init.headers)
    seen.push({
      url,
      method: init.method ?? "GET",
      key: headers.get("x-kiko-key"),
      agent: headers.get("user-agent"),
      body:
        typeof init.body === "string"
          ? init.body
          : init.body
            ? new TextDecoder().decode(init.body as Uint8Array)
            : null,
    })
    const route = routes[url]
    return route ? route() : new Response("missing", { status: 404 })
  }) as unknown as typeof fetch
  const broker = async (url: URL) => (url.origin === "https://app.lakebed.app" ? { "x-kiko-key": "secret" } : null)
  return { seen, fetch: bashFetch(egress, broker) }
}

const redirect = (status: number, location: string) => () => new Response(null, { status, headers: { location } })

describe("bash fetch", () => {
  it("names itself like curl unless the command sets a user agent", async () => {
    const { seen, fetch } = world({ "https://api.example/x": () => new Response("ok") })
    await fetch("https://api.example/x")
    await fetch("https://api.example/x", { headers: { "User-Agent": "mine" } })
    expect(seen[0]?.agent).toMatch(/^curl\//)
    expect(seen[1]?.agent).toBe("mine")
  })

  it("signs requests to the app and drops the key when a redirect leaves its origin", async () => {
    const { seen, fetch } = world({
      "https://app.lakebed.app/ingest": redirect(307, "https://elsewhere.example/steal"),
      "https://elsewhere.example/steal": () => new Response("ok"),
    })
    const out = await fetch("https://app.lakebed.app/ingest", { method: "POST", body: "{}" })
    expect(new TextDecoder().decode(out.body)).toBe("ok")
    expect(seen.map((s) => [s.url, s.key])).toEqual([
      ["https://app.lakebed.app/ingest", "secret"],
      ["https://elsewhere.example/steal", null],
    ])
    expect(out.redirectChain?.map((hop) => hop.status)).toEqual([307])
  })

  it("turns a POST into a GET without a body after a 303", async () => {
    const { seen, fetch } = world({
      "https://api.example/form": redirect(303, "/done"),
      "https://api.example/done": () => new Response("done"),
    })
    await fetch("https://api.example/form", { method: "POST", body: "a=1" })
    expect(seen.map((s) => [s.method, s.body])).toEqual([
      ["POST", "a=1"],
      ["GET", null],
    ])
  })

  it("refuses plain http before anything is sent", async () => {
    const { seen, fetch } = world({})
    await expect(fetch("http://api.example/data")).rejects.toThrow("only https://")
    expect(seen).toEqual([])
  })

  it("refuses ip literals and private addresses before anything is sent", async () => {
    const { seen, fetch } = world({}, { "private.example": "10.0.0.5" })
    await expect(fetch("https://127.0.0.1/x")).rejects.toThrow("ip-literal")
    await expect(fetch("https://private.example/x")).rejects.toThrow("blocked-address")
    expect(seen).toEqual([])
  })

  it("stops a redirect loop", async () => {
    const { fetch } = world({ "https://api.example/loop": redirect(302, "/loop") })
    await expect(fetch("https://api.example/loop")).rejects.toThrow("redirects")
  })
})
