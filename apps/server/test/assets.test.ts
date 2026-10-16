import { expect, test } from "bun:test"
import { serveAsset } from "../src/lib/assets"

// The asset server in single-page mode: a known file, or index.html for anything it does not have.
const assets = {
  fetch: async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    if (path === "/assets/main-abc.js") return new Response("export {}", { headers: { "content-type": "text/javascript" } })
    return new Response("<!doctype html>", { headers: { "content-type": "text/html", "cache-control": "public, max-age=31536000, immutable" } })
  },
} as unknown as Fetcher

const get = (path: string) => serveAsset(assets, new Request(`https://kiko.example${path}`))

test("a chunk the deploy has not spread to yet is a 404 no one caches, not index.html", async () => {
  const res = await get("/assets/chunk-new.js")
  expect(res.status).toBe(404)
  expect(res.headers.get("cache-control")).toBe("no-store")
})

test("a real chunk and an app route still come back as before", async () => {
  expect(await (await get("/assets/main-abc.js")).text()).toBe("export {}")
  const page = await get("/welcome")
  expect(page.status).toBe(200)
  expect(page.headers.get("content-type")).toBe("text/html")
})
