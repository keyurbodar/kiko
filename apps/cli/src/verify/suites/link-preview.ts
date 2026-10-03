import type { RoomToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// A one pixel png.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
)

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function ulid(): string {
  let time = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

// The dev Worker maps `fixture-<port>.preview.test` to `http://localhost:<port>`.
// Every fetch still goes through safeFetch. See apps/server/src/previews/route.ts.
const suite: Suite = {
  name: "link-preview",
  async run(v) {
    const hits = new Map<string, number>()
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname
        hits.set(path, (hits.get(path) ?? 0) + 1)
        const html = (head: string) =>
          new Response(`<html><head>${head}</head><body></body></html>`, { headers: { "content-type": "text/html" } })
        if (path === "/tagged") {
          return html(`<title>fallback</title>
            <meta property="og:title" content="a tagged page">
            <meta property="og:description" content="what it says">
            <meta property="og:site_name" content="fixture site">
            <meta property="og:image" content="/pic.png">
            <link rel="icon" href="/pic.png">`)
        }
        if (path === "/bare") return html("")
        if (path === "/pic.png") return new Response(PNG, { headers: { "content-type": "image/png" } })
        return new Response("no", { status: 404 })
      },
    })
    try {
      const base = v.url.endsWith("/") ? v.url : `${v.url}/`
      const s = await v.as("alice")
      const get = (path: string, cookie = s.cookie) => fetch(new URL(path, base), { headers: cookie ? { cookie } : {} })
      const host = `http://fixture-${server.port}.preview.test`
      const ask = async (path: string) => {
        const res = await get(`api/preview?url=${encodeURIComponent(host + path)}`)
        if (res.status !== 200) throw new VerifyError(`preview ${path} answered ${res.status}`)
        return (await res.json()) as { cache: string; preview: Record<string, string> | null }
      }

      expectEqual((await get(`api/preview?url=${encodeURIComponent(host)}`, "")).status, 401, "a preview needs a session")

      // The query makes the key new each run, so an answer cached by an earlier run cannot hide a bug.
      const run = `?run=${Date.now()}`
      const first = await ask(`/tagged${run}`)
      expectEqual(first.cache, "fresh", "the first call fetches")
      expectEqual(first.preview?.title, "a tagged page", "og:title")
      expectEqual(first.preview?.description, "what it says", "og:description")
      expectEqual(first.preview?.siteName, "fixture site", "og:site_name")
      const image = first.preview?.image ?? ""
      if (!image.startsWith("/api/preview-image/")) throw new VerifyError(`the image must be on kiko's origin, got ${image}`)
      if (`${first.preview?.image}${first.preview?.favicon}`.includes("preview.test")) throw new VerifyError("a third-party url reached the client")

      const second = await ask(`/tagged${run}`)
      expectEqual(second.cache, "hit", "the second call is served from KV")
      expectEqual(second.preview?.title, "a tagged page", "the cached title")
      expectEqual(hits.get("/tagged"), 1, "the page was fetched once")

      // The image route fetches through on its first request, so the image works the moment the preview does.
      const res = await get(image)
      expectEqual(res.status, 200, "the image is served at once")
      expectEqual(res.headers.get("content-type"), "image/png", "the image type")
      expectEqual((await res.arrayBuffer()).byteLength, PNG.byteLength, "the image bytes")
      expectEqual((await get(image, "")).status, 401, "the image needs a session")
      const reread = await get(image)
      expectEqual(reread.status, 200, "a second read of the image")
      expectEqual(hits.get("/pic.png"), 1, "the image was fetched from the page once, then served from R2")
      expectEqual((await get(`${image.slice(0, -4)}AAAA`)).status, 404, "a forged image token opens nothing")

      // A posted message with a link gets its card from the room, in a preview event.
      const roomId = ulid()
      const room = await s.room(roomId)
      await room.expect((f) => f.t === "events")
      const link = `${host}/tagged${run}`
      room.send(`look at this ${link}`)
      const card = (await room.expect(
        (f) => f.t === "events" && f.events.some((e) => e.t === "preview"),
        10_000,
      )) as Extract<RoomToClient, { t: "events" }>
      const event = card.events.find((e) => e.t === "preview")
      if (event?.t !== "preview") throw new VerifyError("no preview event")
      expectEqual(event.preview.title, "a tagged page", "the message's card title")
      expectEqual(event.preview.url, link, "the card is for the message's first link")
      expectEqual(hits.get("/tagged"), 1, "the room used the cached preview")

      const bare = `/bare${run}`
      expectEqual((await ask(bare)).preview, null, "a page with no tags has no preview")
      const again = await ask(bare)
      expectEqual(again.cache, "hit", "a miss is cached")
      expectEqual(again.preview, null, "the cached miss")
      expectEqual(hits.get("/bare"), 1, "the bare page was fetched once")

      const blocked = await get(`api/preview?url=${encodeURIComponent("http://127.0.0.1:1/")}`)
      expectEqual(((await blocked.json()) as { preview: unknown }).preview, null, "a private address gets no preview")
    } finally {
      server.stop(true)
    }
  },
}

export default suite
