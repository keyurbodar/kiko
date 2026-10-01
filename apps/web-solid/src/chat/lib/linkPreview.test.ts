import { describe, expect, test } from "bun:test"
import { hasWebPageContent, parseLinkPreview } from "./linkPreview"

const URL_ = "https://example.com/post"

function head(...tags: string[]): string {
  return `<html><head>${tags.join("")}</head><body></body></html>`
}

describe("parseLinkPreview", () => {
  test("a title alone earns a preview", () => {
    const page = parseLinkPreview(head("<title>Hello</title>"), URL_)
    expect(page?.title).toBe("Hello")
    expect(page?.media).toBeUndefined()
  })

  test("an image alone earns nothing", () => {
    const html = head('<meta property="og:image" content="https://example.com/a.png">')
    expect(parseLinkPreview(html, URL_)).toBeNull()
  })

  test("a square image is a small thumbnail", () => {
    const html = head(
      '<meta property="og:title" content="Profile">',
      '<meta property="og:image" content="https://example.com/a.png">',
      '<meta property="og:image:width" content="400">',
      '<meta property="og:image:height" content="400">',
    )
    expect(parseLinkPreview(html, URL_)?.mediaSize).toBe("small")
  })

  test("a wide image is large", () => {
    const html = head(
      '<meta property="og:title" content="Video">',
      '<meta property="og:image" content="https://example.com/a.png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
    )
    const page = parseLinkPreview(html, URL_)
    expect(page?.mediaSize).toBe("large")
    expect(page?.media?.width).toBe(420)
  })

  test("an image without declared size is large and reserves 1.91:1", () => {
    const html = head(
      '<meta property="og:title" content="Video">',
      '<meta property="og:image" content="https://example.com/a.png">',
    )
    const page = parseLinkPreview(html, URL_)
    expect(page?.mediaSize).toBe("large")
    expect(page?.media?.width).toBe(420)
    expect(page?.media?.height).toBe(Math.round(420 / (1200 / 630)))
  })

  test("twitter summary_large_image wins over a square declared size", () => {
    const html = head(
      '<meta property="og:title" content="Repo">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta property="og:image" content="https://example.com/a.png">',
      '<meta property="og:image:width" content="400">',
      '<meta property="og:image:height" content="400">',
    )
    expect(parseLinkPreview(html, URL_)?.mediaSize).toBe("large")
  })

  test("video and article types are large", () => {
    for (const type of ["video.other", "article"]) {
      const html = head(
        '<meta property="og:title" content="Thing">',
        `<meta property="og:type" content="${type}">`,
        '<meta property="og:image" content="https://example.com/a.png">',
        '<meta property="og:image:width" content="300">',
        '<meta property="og:image:height" content="300">',
      )
      expect(parseLinkPreview(html, URL_)?.mediaSize).toBe("large")
    }
  })

  test("twitter summary card is small even without a size", () => {
    const html = head(
      '<meta property="og:title" content="Someone">',
      '<meta name="twitter:card" content="summary">',
      '<meta property="og:image" content="https://example.com/a.png">',
    )
    expect(parseLinkPreview(html, URL_)?.mediaSize).toBe("small")
  })

  test("a narrow image is small", () => {
    const html = head(
      '<meta property="og:title" content="Icon">',
      '<meta property="og:image" content="https://example.com/a.png">',
      '<meta property="og:image:width" content="150">',
      '<meta property="og:image:height" content="100">',
    )
    expect(parseLinkPreview(html, URL_)?.mediaSize).toBe("small")
  })
  test("a profile page is small even when wide", () => {
    const html = head(
      '<meta property="og:title" content="Someone">',
      '<meta property="og:type" content="profile">',
      '<meta property="og:image" content="https://example.com/a.png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
    )
    expect(parseLinkPreview(html, URL_)?.mediaSize).toBe("small")
  })

  test("a relative image resolves against the page", () => {
    const html = head(
      '<meta property="og:title" content="Post">',
      '<meta property="og:image" content="/cover.jpg">',
    )
    expect(parseLinkPreview(html, URL_)?.media?.src).toBe("https://example.com/cover.jpg")
  })

  test("site name falls back to the hostname and entities decode", () => {
    const html = head('<meta property="og:title" content="Tom &amp; Jerry">')
    const page = parseLinkPreview(html, "https://www.example.com/x")
    expect(page?.site).toBe("example.com")
    expect(page?.title).toBe("Tom & Jerry")
  })
})

describe("hasWebPageContent", () => {
  test("needs a title or description", () => {
    expect(hasWebPageContent({ url: URL_, site: "example.com" })).toBe(false)
    expect(hasWebPageContent({ url: URL_, description: "d" })).toBe(true)
  })
})
