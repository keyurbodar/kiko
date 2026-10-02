import { afterEach, describe, expect, test } from "bun:test"
import {
  clearLinkPreviewCache,
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
