import { describe, expect, test } from "bun:test"
import { faviconHost, fetchFavicon } from "../src/favicon/route"

describe("the favicon route fetches only public DNS names", () => {
	test.each([
		["localhost", "localhost"],
		["a name with no dot", "intranet"],
		["an IPv4 literal", "127.0.0.1"],
		["a private IPv4 literal", "10.0.0.1"],
		["an IPv6 literal", "[::1]"],
		["a host with a port", "example.com:8080"],
		["a path", "example.com/x"],
		["a localhost subdomain", "a.localhost.."],
		["empty", ""],
	])("refuses %s", (_, raw) => {
		expect(faviconHost(raw)).toBeNull()
	})

	test("accepts a public name and folds its case", () => {
		expect(faviconHost("GitHub.com")).toBe("github.com")
		expect(faviconHost("xn--bcher-kva.example")).toBe("xn--bcher-kva.example")
	})
})

describe("fetchFavicon", () => {
	const dns = (host: string, address: string) => (url: string) =>
		url.startsWith("https://cloudflare-dns.com/dns-query")
			? new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: address }] }), { headers: { "content-type": "application/dns-json" } })
			: undefined
	const fetcher = (address: string, reply: () => Response) => async (url: string) => dns("", address)(url) ?? reply()

	test("a public host's image comes back with a long cache", async () => {
		const res = await fetchFavicon("example.com", fetcher("93.184.216.34", () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })))
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toBe("image/png")
		expect(res.headers.get("cache-control")).toContain("max-age=604800")
	})

	test("a page that is not an image is a 404", async () => {
		const res = await fetchFavicon("example.com", fetcher("93.184.216.34", () => new Response("<html>", { headers: { "content-type": "text/html" } })))
		expect(res.status).toBe(404)
	})

	test("a host that resolves to a private address is never fetched", async () => {
		let hit = false
		const res = await fetchFavicon("evil.example", fetcher("10.0.0.5", () => ((hit = true), new Response("x", { headers: { "content-type": "image/png" } }))))
		expect(res.status).toBe(404)
		expect(hit).toBe(false)
	})

	test("an image over the size cap is a 404", async () => {
		const res = await fetchFavicon("example.com", fetcher("93.184.216.34", () => new Response(new Uint8Array(100_000), { headers: { "content-type": "image/png" } })))
		expect(res.status).toBe(404)
	})
})
