import "fake-indexeddb/auto"
import { afterEach, describe, expect, test } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import { openWarm } from "../../warm/db"
import { loadPreviews, savePreview } from "../../warm/previews"
import {
  attachPreviewShelf,
  cardColor,
  clearLinkPreviewCache,
  isLinkOnly,
  Lru,
  MEMORY_CAP,
  peekLinkPreview,
  rememberCardColor,
  hasWebPageContent,
  isOwnOriginImage,
  ownMedia,
  resolveLinkPreview,
} from "./linkPreview"

const URL_ = "https://example.com/post"
const realFetch = globalThis.fetch

function stubFetch(respond: (url: string) => Response | Promise<Response>): string[] {
  const calls: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input))
    return Promise.resolve(respond(String(input)))
  }) as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
  clearLinkPreviewCache()
})

describe("resolveLinkPreview", () => {
  test("maps the server fields and calls /api/preview", async () => {
    const calls = stubFetch(() =>
      Response.json({
        cache: "fresh",
        preview: {
          url: URL_,
          title: "Hello",
          description: "d",
          siteName: "Example",
          image: "/api/preview-image/ab",
          favicon: "/api/preview-image/cd",
        },
      }),
    )
    const page = await resolveLinkPreview(URL_)
    expect(calls).toEqual([`/api/preview?url=${encodeURIComponent(URL_)}`])
    expect(page).toMatchObject({ site: "Example", title: "Hello", favicon: "/api/preview-image/cd", mediaSize: "large" })
    expect(page?.media?.src).toBe("/api/preview-image/ab")
  })

  test("no preview from the server is null", async () => {
    stubFetch(() => Response.json({ preview: null, cache: "fresh" }))
    expect(await resolveLinkPreview(URL_)).toBeNull()
  })

  test("a second lookup for one url does not refetch", async () => {
    const calls = stubFetch(() => Response.json({ preview: { url: URL_, title: "t" } }))
    await resolveLinkPreview(URL_)
    await resolveLinkPreview(URL_)
    expect(calls.length).toBe(1)
  })

  test("a failed lookup is not cached", async () => {
    let status = 429
    const calls = stubFetch(() =>
      status === 429 ? new Response("", { status }) : Response.json({ preview: { url: URL_, title: "t" } }),
    )
    expect(await resolveLinkPreview(URL_)).toBeNull()
    status = 200
    expect((await resolveLinkPreview(URL_))?.title).toBe("t")
    expect(calls.length).toBe(2)
  })

  test("an aborted lookup resolves null", async () => {
    stubFetch(() => new Promise<Response>(() => {}))
    const controller = new AbortController()
    const pending = resolveLinkPreview(URL_, controller.signal)
    controller.abort()
    expect(await pending).toBeNull()
  })

  test("a non-http url never reaches the server", async () => {
    const calls = stubFetch(() => Response.json({ preview: null }))
    expect(await resolveLinkPreview("javascript:alert(1)")).toBeNull()
    expect(calls.length).toBe(0)
  })
})

describe("hasWebPageContent", () => {
  test("needs a title or description", () => {
    expect(hasWebPageContent({ url: URL_, site: "example.com" })).toBe(false)
    expect(hasWebPageContent({ url: URL_, description: "d" })).toBe(true)
  })
})

describe("own-origin images", () => {
  const origin = "http://localhost:5339"
  test("a third-party image is refused", () => {
    expect(isOwnOriginImage("https://example.com/a.png", origin)).toBe(false)
  })
  test("a relative path and the same origin load", () => {
    expect(isOwnOriginImage("/api/img/a.png", origin)).toBe(true)
    expect(isOwnOriginImage(`${origin}/a.png`, origin)).toBe(true)
  })
  test("ownMedia drops a foreign image", () => {
    const media = { src: "https://example.com/a.png", width: 10, height: 10 }
    expect(ownMedia({ url: "https://example.com", title: "t", media })).toBeUndefined()
  })
})

describe("the preview cache", () => {
  test("the LRU keeps its cap and forgets the least recently used", () => {
    const lru = new Lru<string, number>(3)
    for (const k of ["a", "b", "c"]) lru.set(k, 1)
    lru.get("a")
    lru.set("d", 1)
    expect(lru.size).toBe(3)
    expect(lru.get("b")).toBeUndefined()
    expect(lru.get("a")).toBe(1)
  })

  test("memory holds at most MEMORY_CAP previews", async () => {
    stubFetch((url) => Response.json({ preview: { url: decodeURIComponent(url.split("url=")[1]!), title: "t" } }))
    for (let i = 0; i < MEMORY_CAP + 20; i++) await resolveLinkPreview(`https://a.test/${i}`)
    expect(peekLinkPreview("https://a.test/0")).toBeUndefined()
    expect(peekLinkPreview(`https://a.test/${MEMORY_CAP + 19}`)?.title).toBe("t")
  })

  test("a looked-up preview is there synchronously, fragment or not, for the sent message", async () => {
    stubFetch(() => Response.json({ preview: { url: URL_, title: "t" } }))
    expect(peekLinkPreview(URL_)).toBeUndefined()
    await resolveLinkPreview(URL_)
    expect(peekLinkPreview(`${URL_}#top`)?.title).toBe("t")
  })

  test("a reload reads previews and colours from IndexedDB without the network", async () => {
    const idb = new IDBFactory()
    const warm = await openWarm({ userId: "u1", idb, flushEveryMs: 1 })
    await attachPreviewShelf(warm)
    stubFetch(() => Response.json({ preview: { url: URL_, title: "t" } }))
    const page = (await resolveLinkPreview(URL_))!
    rememberCardColor(page, "#aa2020")
    await warm.flush()
    warm.close()

    clearLinkPreviewCache()
    const calls = stubFetch(() => Response.json({ preview: null }))
    await attachPreviewShelf(await openWarm({ userId: "u1", idb }))
    expect(peekLinkPreview(URL_)?.title).toBe("t")
    expect(cardColor(page)).toBe("#aa2020")
    expect(calls.length).toBe(0)
  })

  test("the shelf keeps the newest previews up to its cap", async () => {
    const warm = await openWarm({ userId: "u2", idb: new IDBFactory(), flushEveryMs: 1 })
    for (let i = 0; i < 8; i++) savePreview(warm, { url: `https://a.test/${i}`, preview: null, at: i })
    expect((await loadPreviews(warm, 5)).map((r) => r.at)).toEqual([7, 6, 5, 4, 3])
    await warm.flush()
    expect((await warm.getAll("previews")).length).toBe(5)
  })
})

describe("isLinkOnly", () => {
  const page = { url: "https://youtu.be/x", title: "a video" }
  test("only a bare link is card-only", () => {
    expect(isLinkOnly(" https://youtu.be/x ", page)).toBe(true)
    expect(isLinkOnly("look https://youtu.be/x", page)).toBe(false)
    expect(isLinkOnly("https://youtu.be/x", { url: page.url })).toBe(false)
  })
})
