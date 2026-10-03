import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { RoomEvent, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { type Fetcher, safeFetch } from "../src/lib/safe-fetch"
import { imageHash, imagePath, IMAGE_PREFIX, openToken, serveImage } from "../src/previews/image"
import { fragmentText, oembedFor } from "../src/previews/oembed"
import { parsePreview } from "../src/previews/parse"
import { headWatcher, PREVIEW_USER_AGENT, resolvePreview } from "../src/previews/resolve"
import { previewTarget, previewUrl } from "../src/room/link-preview"

// Architecture section 18.2: link previews, from the page's head to the card on the message.

const SECRET = "test-secret-for-preview-images"
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
)

/** Answers DNS with a public address, then hands every other request to `serve`. */
function fakeWeb(serve: (url: URL, init: RequestInit) => Response | Promise<Response>): Fetcher & { hits: string[] } {
  const hits: string[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    const u = new URL(url)
    if (u.hostname === "cloudflare-dns.com") {
      const a = u.searchParams.get("type") === "A"
      return Response.json({ Status: 0, Answer: a ? [{ type: 1, data: "93.184.216.34" }] : [] })
    }
    hits.push(u.pathname + u.search)
    return serve(u, init)
  }) as Fetcher & { hits: string[] }
  fetcher.hits = hits
  return fetcher
}

function fakeKv() {
  const map = new Map<string, string>()
  return {
    map,
    kv: {
      get: async (key: string, type?: string) => {
        const v = map.get(key)
        return v === undefined ? null : type === "json" ? JSON.parse(v) : v
      },
      put: async (key: string, value: string) => void map.set(key, value),
    } as unknown as KVNamespace,
  }
}

function fakeR2() {
  const objects = new Map<string, { body: Uint8Array; type: string }>()
  let puts = 0
  const bucket = {
    get: async (key: string) => {
      const o = objects.get(key)
      return o ? { body: o.body, httpMetadata: { contentType: o.type } } : null
    },
    put: async (key: string, body: Uint8Array, opts: { httpMetadata: { contentType: string } }) => {
      puts++
      objects.set(key, { body, type: opts.httpMetadata.contentType })
    },
  } as unknown as R2Bucket
  return { objects, bucket, puts: () => puts }
}

const later = () => {
  const work: Promise<unknown>[] = []
  return { waitUntil: (w: Promise<unknown>) => void work.push(w), settle: () => Promise.all(work) }
}

describe("parse", () => {
  test("reads theme-color, skips a dark-only one, and refuses a non-colour", async () => {
    const page = (head: string) => parsePreview(`<html><head><title>t</title>${head}</head><body></body></html>`, "https://a.test/")
    expect((await page(`<meta name="theme-color" content="#D64040">`)).themeColor).toBe("#d64040")
    expect(
      (await page(`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000"><meta name="theme-color" content="rgb(255, 69, 0)">`))
        .themeColor,
    ).toBe("rgb(255, 69, 0)")
    expect((await page(`<meta name="theme-color" content="var(--x); background: url(x)">`)).themeColor).toBeUndefined()
  })
})

test("an entity-encoded og:image resolves to the real URL", async () => {
  const page = await parsePreview(
    `<html><head><meta property="og:image" content="https:&#x2f;&#x2f;earendil.com&#x2f;static&#x2f;og.png"><title>a &amp; b</title></head></html>`,
    "https://earendil.com/posts/x/",
  )
  expect(page.image).toBe("https://earendil.com/static/og.png")
  expect(page.title).toBe("a & b")
})

describe("head-only reading", () => {
  test("stops at the end of the head and never pulls the body", async () => {
    let pulls = 0
    const head = new TextEncoder().encode(`<html><head><meta property="og:title" content="fast"></he`)
    const end = new TextEncoder().encode(`ad><body>`)
    const filler = new Uint8Array(64 * 1024).fill(120)
    const web = fakeWeb(() => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++
          // The tag is split across two chunks, then the body would go on forever.
          controller.enqueue(pulls === 1 ? head : pulls === 2 ? end : filler)
        },
      })
      return new Response(stream, { headers: { "content-type": "text/html" } })
    })
    const result = await safeFetch("https://slow.test/", web, { stop: headWatcher(), maxBytes: 512 * 1024 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.body.byteLength).toBe(head.byteLength + end.byteLength)
    expect(pulls).toBeLessThan(5)
  })

  test("sends the preview user agent and nothing else of the caller's", async () => {
    let agent: string | null = null
    const web = fakeWeb((_, init) => {
      agent = new Headers(init.headers).get("user-agent")
      return new Response("<html><head><title>x</title></head></html>", { headers: { "content-type": "text/html" } })
    })
    await safeFetch("https://ua.test/", web, { userAgent: PREVIEW_USER_AGENT })
    expect(agent).toBe(PREVIEW_USER_AGENT)
  })
})

describe("image route", () => {
  test("a token round-trips, is stable, and a forged one opens nothing", async () => {
    const path = await imagePath(SECRET, "https://img.test/a.png")
    expect(path).toBe(await imagePath(SECRET, "https://img.test/a.png"))
    expect(path).not.toContain("img.test")
    const token = path.split("/").pop()!
    expect(await openToken(SECRET, token)).toBe("https://img.test/a.png")
    expect(await openToken("another-secret", token)).toBeNull()
    expect(await openToken(SECRET, `${token.slice(0, -2)}AA`)).toBeNull()
  })

  test("a miss fetches through at once, stores once, and later reads come from R2", async () => {
    const r2 = fakeR2()
    const web = fakeWeb(() => new Response(PNG, { headers: { "content-type": "image/png" } }))
    const token = (await imagePath(SECRET, "https://img.test/pic.png")).split("/").pop()!
    const env = { FILES: r2.bucket, BETTER_AUTH_SECRET: SECRET }

    const first = later()
    const res = await serveImage(env, token, first.waitUntil, web)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
    await first.settle()
    expect(r2.objects.has(IMAGE_PREFIX + (await imageHash("https://img.test/pic.png")))).toBe(true)

    const second = later()
    const again = await serveImage(env, token, second.waitUntil, web)
    expect(again.status).toBe(200)
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG)
    expect(web.hits).toEqual(["/pic.png"])
    expect(r2.puts()).toBe(1)
  })

  test("a server error is answered 503 and not cached, so the next look tries again", async () => {
    const r2 = fakeR2()
    const web = fakeWeb(() => new Response("busy", { status: 503 }))
    const token = (await imagePath(SECRET, "https://img.test/busy.png")).split("/").pop()!
    const res = await serveImage({ FILES: r2.bucket, BETTER_AUTH_SECRET: SECRET }, token, () => {}, web)
    expect(res.status).toBe(503)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(r2.puts()).toBe(0)
  })

  test("a page that is not a raster image is refused and not stored", async () => {
    const r2 = fakeR2()
    const web = fakeWeb(() => new Response("<svg onload=x>", { headers: { "content-type": "image/svg+xml" } }))
    const token = (await imagePath(SECRET, "https://img.test/x.svg")).split("/").pop()!
    const res = await serveImage({ FILES: r2.bucket, BETTER_AUTH_SECRET: SECRET }, token, () => {}, web)
    expect(res.status).toBe(404)
    expect(r2.puts()).toBe(0)
  })
})

describe("resolve", () => {
  test("builds once, caches in KV, and serves the image on kiko's origin", async () => {
    const { kv, map } = fakeKv()
    const web = fakeWeb(
      () =>
        new Response(
          `<html><head><meta property="og:title" content="hello"><meta property="og:image" content="/i.png"><meta name="theme-color" content="#ff4500"></head><body>`,
          { headers: { "content-type": "text/html" } },
        ),
    )
    const env = { PREVIEWS: kv, BETTER_AUTH_SECRET: SECRET }
    const run = later()
    const first = await resolvePreview(env, "https://site.test/page", run.waitUntil, { fetcher: web })
    await run.settle()
    expect(first.cache).toBe("fresh")
    expect(first.preview).toMatchObject({ url: "https://site.test/page", title: "hello", themeColor: "#ff4500" })
    expect(first.preview?.image).toStartWith("/api/preview-image/")
    expect(await openToken(SECRET, first.preview!.image!.split("/").pop()!)).toBe("https://site.test/i.png")
    expect(map.size).toBe(1)

    const second = await resolvePreview(env, "https://site.test/page", () => {}, { fetcher: web })
    expect(second).toEqual({ preview: first.preview, cache: "hit" })
    expect(web.hits).toEqual(["/page"])
  })

  test("YouTube answers from oEmbed, never the watch page", async () => {
    const { kv } = fakeKv()
    const web = fakeWeb((url) =>
      url.pathname === "/oembed"
        ? Response.json({ title: "a video", author_name: "a channel", thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg" })
        : new Response("too slow", { status: 500 }),
    )
    const { preview } = await resolvePreview({ PREVIEWS: kv, BETTER_AUTH_SECRET: SECRET }, "https://youtu.be/abc", () => {}, { fetcher: web })
    expect(preview).toMatchObject({ title: "a video", description: "a channel", siteName: "YouTube" })
    expect(web.hits).toEqual(["/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabc"])
  })

  test("oEmbed covers YouTube and X posts only, and a tweet's text is decoded", () => {
    expect(oembedFor("https://www.youtube.com/watch?v=1")).not.toBeNull()
    expect(oembedFor("https://x.com/a/status/20")).not.toBeNull()
    expect(oembedFor("https://x.com/a")).toBeNull()
    expect(oembedFor("https://github.com/a/b")).toBeNull()
    expect(fragmentText("just setting up my twttr &amp; more<br>&#128512; &lt;b&gt;")).toBe("just setting up my twttr & more 😀 <b>")
  })

  test("a failed page is cached for a minute, not ten", async () => {
    const { kv } = fakeKv()
    const puts: number[] = []
    const spy = { ...kv, get: kv.get, put: async (_k: string, _v: string, o: { expirationTtl: number }) => void puts.push(o.expirationTtl) } as unknown as KVNamespace
    const web = fakeWeb(() => new Response("down", { status: 503 }))
    const run = later()
    await resolvePreview({ PREVIEWS: spy, BETTER_AUTH_SECRET: SECRET }, "https://down.test/", run.waitUntil, { fetcher: web })
    await run.settle()
    expect(puts).toEqual([60])
  })
})

describe("the room's link", () => {
  test("the first link of a message without files, normalized", () => {
    expect(previewUrl("see https://a.test/x#frag and https://b.test")).toBe("https://a.test/x")
    expect(previewUrl("no links here")).toBeNull()
    const base = { seq: 1, at: 1, id: "m" as never, from: { kind: "human" as const } }
    expect(previewTarget({ t: "message", ...base, text: "https://a.test" })).toEqual({ messageId: "m" as never, url: "https://a.test/" })
    expect(previewTarget({ t: "message", ...base, text: "https://a.test", files: [{ id: "f", name: "x", size: 1, type: "image/png" }] })).toBeNull()
  })
})

// The real RoomDO in workerd, with KV holding a cached preview, so no page is fetched.
describe("room", () => {
  let mf: Miniflare
  let origin: string

  beforeAll(async () => {
    const built = await Bun.build({
      entrypoints: [new URL("./room-worker.ts", import.meta.url).pathname],
      target: "browser",
      format: "esm",
      external: ["cloudflare:workers"],
    })
    if (!built.success) throw new Error(built.logs.join("\n"))
    mf = new Miniflare({
      modules: true,
      script: await built.outputs[0]!.text(),
      compatibilityDate: "2026-07-01",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { ROOM: { className: "RoomDO", useSQLite: true } },
      kvNamespaces: ["PREVIEWS"],
      bindings: { BETTER_AUTH_SECRET: SECRET },
    })
    origin = (await mf.ready).origin
  }, 60_000)

  afterAll(async () => {
    await mf?.dispose()
  })

  test("a message with a link gets its card in a preview event, stored on the message", async () => {
    const preview = { url: "https://cached.test/post", title: "a cached page", image: "/api/preview-image/x" }
    const kv = await mf.getKVNamespace("PREVIEWS")
    await kv.put(`preview:v2:${preview.url}`, JSON.stringify({ preview }))

    const room = `01JZ8Q4T6M9${String(Date.now()).padStart(15, "0")}`
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
    const frames: RoomToClient[] = []
    ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
    await new Promise((r) => (ws.onopen = r))
    ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
    ws.send(JSON.stringify({ t: "send", clientId: "p1", text: "look https://cached.test/post" }))

    const events = () => frames.flatMap((f) => (f.t === "events" ? f.events : []))
    const deadline = Date.now() + 5000
    while (!events().some((e) => e.t === "preview") && Date.now() < deadline) await Bun.sleep(50)
    const message = events().find((e) => e.t === "message") as Extract<RoomEvent, { t: "message" }>
    const card = events().find((e) => e.t === "preview")
    expect(card).toMatchObject({ t: "preview", messageId: message.id, preview })
    expect(card!.seq).toBeGreaterThan(message.seq)
    ws.close()

    // A late socket gets the card in the replay, after the message.
    const late = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
    const replay: RoomToClient[] = []
    late.onmessage = (e) => replay.push(JSON.parse(String(e.data)))
    await new Promise((r) => (late.onopen = r))
    late.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
    while (!replay.length && Date.now() < deadline) await Bun.sleep(20)
    const kinds = replay.flatMap((f) => (f.t === "events" ? f.events.map((e) => e.t) : []))
    expect(kinds.filter((k) => k === "preview")).toHaveLength(1)
    late.close()
  })
})
