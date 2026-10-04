import { afterAll, beforeEach, expect, test } from "bun:test"
import { safeFetch, type Fetcher } from "../src/lib/safe-fetch"

// The tests run the real function against a real HTTP server on this machine.
// One fetcher is injected. It answers DNS over HTTPS lookups from a table and
// sends every other request to the local server, whatever the host name says.
// Nothing leaves the machine.

const MB = 1024 * 1024
const PUBLIC_V4 = "93.184.216.34"
const CHUNK = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251)

function stream(total: number, gapMs = 0): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    async pull(controller) {
      if (sent >= total) return controller.close()
      // Always wait a macrotask. A pull that never yields starves the event loop of an endless stream.
      await Bun.sleep(gapMs)
      controller.enqueue(CHUNK)
      sent += CHUNK.byteLength
    },
  })
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    const hop = /^\/hop\/(\d+)$/.exec(pathname)
    if (hop) {
      const left = Number(hop[1])
      // A relative Location, so the fetcher must resolve it against the current hop.
      if (left > 0) return new Response(null, { status: 302, headers: { location: `/hop/${left - 1}` } })
      return new Response("end of the chain")
    }
    switch (pathname) {
      case "/ok":
        return new Response("hello", { headers: { "content-type": "text/plain" } })
      case "/headers":
        return Response.json(Object.fromEntries(request.headers))
      case "/cookie":
        return new Response(null, { status: 302, headers: { location: "/headers", "set-cookie": "sid=1; Path=/" } })
      case "/to-private":
        return new Response(null, { status: 302, headers: { location: "http://private.test/secret" } })
      case "/to-metadata":
        return new Response(null, { status: 307, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
      case "/to-file":
        return new Response(null, { status: 301, headers: { location: "file:///etc/passwd" } })
      case "/slow":
        await Bun.sleep(4000)
        return new Response("too late")
      case "/drip":
        return new Response(stream(Infinity, 250))
      case "/endless":
        return new Response(stream(Infinity))
      case "/big":
        return new Response(stream(5 * MB))
      case "/exact":
        return new Response(stream(MB))
      default:
        return new Response("not found", { status: 404 })
    }
  },
})

afterAll(() => server.stop(true))

/** Host name to DNS records. A number is a DNS status other than NOERROR. */
let dns: Record<string, { A?: string[]; AAAA?: string[] } | number>
let lookups: string[]
let requests: string[]

beforeEach(() => {
  dns = {
    "public.test": { A: [PUBLIC_V4] },
    "private.test": { A: ["10.0.0.5"] },
  }
  lookups = []
  requests = []
})

const fetcher: Fetcher = async (url, init) => {
  const target = new URL(url)
  if (target.hostname === "cloudflare-dns.com") {
    const name = target.searchParams.get("name")!
    const type = target.searchParams.get("type") as "A" | "AAAA"
    expect(new Headers(init.headers as HeadersInit).get("accept")).toBe("application/dns-json")
    lookups.push(`${type} ${name}`)
    const entry = dns[name]
    if (entry === 500) return new Response("boom", { status: 500 })
    if (typeof entry === "number") return Response.json({ Status: entry }) as unknown as Response
    if (entry === undefined) return Response.json({ Status: 3 }) as unknown as Response
    const code = type === "A" ? 1 : 28
    return Response.json({
      Status: 0,
      // A CNAME record first, as a real resolver returns for an alias.
      Answer: [
        { name, type: 5, TTL: 60, data: "alias.test." },
        ...(entry[type] ?? []).map((data) => ({ name, type: code, TTL: 60, data })),
      ],
    }) as unknown as Response
  }
  requests.push(url)
  const credentials = target.username ? `${target.username}:${target.password}@` : ""
  const local = `http://${credentials}127.0.0.1:${server.port}${target.pathname}${target.search}`
  return (await fetch(local, init as never)) as unknown as Response
}

const text = (body: Uint8Array) => new TextDecoder().decode(body)

test("fetches a public URL and returns its body", async () => {
  const result = await safeFetch("http://public.test/ok", fetcher)
  expect(result).toMatchObject({ ok: true, url: "http://public.test/ok", status: 200, truncated: false })
  if (!result.ok) throw new Error(result.reason)
  expect(text(result.body)).toBe("hello")
  expect(result.headers.get("content-type")).toBe("text/plain")
  expect(lookups.sort()).toEqual(["A public.test", "AAAA public.test"])
})

test("returns a 404 as a result, not a refusal", async () => {
  expect(await safeFetch("https://public.test/missing", fetcher)).toMatchObject({ ok: true, status: 404 })
})

test.each([
  ["http://127.0.0.1/", "ip-literal"],
  ["http://[::1]/", "ip-literal"],
  ["http://169.254.169.254/latest/meta-data/", "ip-literal"],
  ["http://2130706433/", "ip-literal"], // decimal 127.0.0.1
  ["http://0x7f000001/", "ip-literal"], // hex
  ["http://017700000001/", "ip-literal"], // octal
  ["http://127.1/", "ip-literal"], // short form
  ["http://[::ffff:127.0.0.1]/", "ip-literal"],
  ["http://[fd00:ec2::254]/", "ip-literal"],
  ["http://93.184.216.34/", "ip-literal"], // a public literal is refused too
  ["http://localhost/", "blocked-host"],
  ["http://localhost./", "blocked-host"],
  ["http://app.localhost:8787/", "blocked-host"],
  ["http://intranet/", "blocked-host"],
  ["ftp://public.test/", "scheme"],
  ["file:///etc/passwd", "scheme"],
  ["data:text/plain,hi", "scheme"],
  ["javascript:alert(1)", "scheme"],
  ["not a url", "invalid-url"],
  ["", "invalid-url"],
])("refuses %s as %s without any request", async (url, reason) => {
  expect(await safeFetch(url, fetcher)).toMatchObject({ ok: false, reason })
  expect(requests).toEqual([])
  expect(lookups).toEqual([])
})

test.each([
  "10.0.0.5",
  "127.0.0.1",
  "127.255.255.254",
  "169.254.169.254",
  "169.254.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "100.64.0.1",
  "0.0.0.0",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "not-an-address",
])("refuses a host that resolves to %s", async (address) => {
  dns["target.test"] = { A: [address] }
  expect(await safeFetch("http://target.test/ok", fetcher)).toMatchObject({ ok: false, reason: "blocked-address" })
  expect(requests).toEqual([])
})

test.each([
  "::1",
  "::",
  "fe80::1",
  "fd00:ec2::254",
  "fc00::1",
  "::ffff:10.0.0.1",
  "::ffff:a00:1",
  "64:ff9b::a00:1",
  "2002:a00:1::",
  "2001:db8::1",
  "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  "ff02::1",
  "fe80::1%eth0",
])("refuses a host whose AAAA record is %s", async (address) => {
  dns["target.test"] = { AAAA: [address] }
  expect(await safeFetch("http://target.test/ok", fetcher)).toMatchObject({ ok: false, reason: "blocked-address" })
  expect(requests).toEqual([])
})

test.each([
  { A: ["172.32.0.1"] },
  { A: ["172.15.255.255"] },
  { A: ["100.63.255.255"] },
  { A: ["169.253.255.255"] },
  { A: ["223.255.255.255"] },
  { AAAA: ["2606:4700:4700::1111"] },
  { AAAA: ["2a00:1450:4001:81b::200e"] },
  { A: [PUBLIC_V4], AAAA: ["2606:2800:220:1:248:1893:25c8:1946"] },
])("allows a host that resolves to %j", async (records) => {
  dns["target.test"] = records
  expect(await safeFetch("http://target.test/ok", fetcher)).toMatchObject({ ok: true, status: 200 })
})

test.each([
  { A: [PUBLIC_V4, "10.0.0.5"] },
  { A: [PUBLIC_V4], AAAA: ["fd00::1"] },
  { A: ["192.168.0.1"], AAAA: ["2606:4700:4700::1111"] },
])("checks every address, and refuses %j", async (records) => {
  dns["mixed.test"] = records
  expect(await safeFetch("http://mixed.test/ok", fetcher)).toMatchObject({ ok: false, reason: "blocked-address" })
  expect(requests).toEqual([])
})

test.each([
  ["a name that does not exist", undefined],
  ["a resolver failure", 2],
  ["a resolver HTTP error", 500],
  ["a name with no address records", {}],
])("refuses %s as dns-failed", async (_label, entry) => {
  if (entry === undefined) delete dns["gone.test"]
  else dns["gone.test"] = entry
  expect(await safeFetch("http://gone.test/ok", fetcher)).toMatchObject({ ok: false, reason: "dns-failed" })
  expect(requests).toEqual([])
})

test("refuses a public URL that redirects to a private host, and never requests it", async () => {
  expect(await safeFetch("http://public.test/to-private", fetcher)).toEqual({
    ok: false,
    reason: "blocked-address",
    url: "http://private.test/secret",
  })
  expect(requests).toEqual(["http://public.test/to-private"])
})

test("refuses a redirect to the metadata address", async () => {
  expect(await safeFetch("http://public.test/to-metadata", fetcher)).toMatchObject({
    ok: false,
    reason: "ip-literal",
    url: "http://169.254.169.254/latest/meta-data/",
  })
  expect(requests).toEqual(["http://public.test/to-metadata"])
})

test("refuses a redirect to another scheme", async () => {
  expect(await safeFetch("http://public.test/to-file", fetcher)).toMatchObject({ ok: false, reason: "scheme" })
})

test("follows three redirects and looks the host up again on each hop", async () => {
  const result = await safeFetch("http://public.test/hop/3", fetcher)
  expect(result).toMatchObject({ ok: true, url: "http://public.test/hop/0", status: 200 })
  if (!result.ok) throw new Error(result.reason)
  expect(text(result.body)).toBe("end of the chain")
  expect(requests).toEqual([3, 2, 1, 0].map((left) => `http://public.test/hop/${left}`))
  expect(lookups.filter((lookup) => lookup === "A public.test")).toHaveLength(4)
})

test("refuses a fourth redirect", async () => {
  expect(await safeFetch("http://public.test/hop/4", fetcher)).toMatchObject({
    ok: false,
    reason: "too-many-redirects",
  })
  // Hops 4, 3, 2, and 1 are requested. The fourth Location, /hop/0, is not.
  expect(requests).toEqual([4, 3, 2, 1].map((left) => `http://public.test/hop/${left}`))
})

test("sends no cookie and no authorization header", async () => {
  const result = await safeFetch("http://user:secret@public.test/cookie", fetcher)
  if (!result.ok) throw new Error(result.reason)
  expect(result.url).toBe("http://public.test/headers")
  expect(requests).toEqual(["http://public.test/cookie", "http://public.test/headers"])
  const sent = JSON.parse(text(result.body)) as Record<string, string>
  expect(sent.accept).toBe("*/*")
  expect(sent.cookie).toBeUndefined()
  expect(sent.authorization).toBeUndefined()
})

test("times out a response that takes 4 seconds", async () => {
  const started = performance.now()
  expect(await safeFetch("http://public.test/slow", fetcher)).toMatchObject({ ok: false, reason: "timeout" })
  const elapsed = performance.now() - started
  expect(elapsed).toBeGreaterThan(2900)
  expect(elapsed).toBeLessThan(3500)
}, 10_000)

test("times out a body that keeps trickling", async () => {
  const started = performance.now()
  expect(await safeFetch("http://public.test/drip", fetcher)).toMatchObject({ ok: false, reason: "timeout" })
  expect(performance.now() - started).toBeLessThan(3500)
}, 10_000)

test("stops reading a 5 MB body after 1 MB", async () => {
  const result = await safeFetch("http://public.test/big", fetcher)
  if (!result.ok) throw new Error(result.reason)
  expect(result.truncated).toBe(true)
  expect(result.body.byteLength).toBe(MB)
  // The bytes kept are the first ones, in order.
  expect(result.body.every((byte, index) => byte === CHUNK[index % CHUNK.byteLength])).toBe(true)
})

test("stops reading a body that never ends, well before the timeout", async () => {
  const started = performance.now()
  const result = await safeFetch("http://public.test/endless", fetcher)
  expect(result).toMatchObject({ ok: true, truncated: true })
  expect(performance.now() - started).toBeLessThan(2000)
})

test("does not mark a body of exactly 1 MB as truncated", async () => {
  const result = await safeFetch("http://public.test/exact", fetcher)
  if (!result.ok) throw new Error(result.reason)
  expect(result.truncated).toBe(false)
  expect(result.body.byteLength).toBe(MB)
})

test("with the dns cache on, a second fetch to the same host makes no lookup, and each fetcher keeps its own answers", async () => {
  const own: Fetcher = (url, init) => fetcher(url, init)
  expect((await safeFetch("http://public.test/small", own, { dnsCache: true })).ok).toBe(true)
  expect((await safeFetch("http://public.test/small", own, { dnsCache: true })).ok).toBe(true)
  expect(lookups).toEqual(["A public.test", "AAAA public.test"])
  expect(requests).toHaveLength(2)
  // Off (the default for a fetcher a caller passes): every fetch looks the host up again.
  lookups = []
  await safeFetch("http://public.test/small", fetcher)
  await safeFetch("http://public.test/small", fetcher)
  expect(lookups).toHaveLength(4)
})
