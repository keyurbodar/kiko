import { decodeEntities, type ParsedPage } from "./parse"

// Sites whose page is too slow or too empty to read, answered by their oEmbed endpoint instead.
// YouTube's watch page is over a megabyte and its meta tags sit 700 KB in. X serves no meta tags
// at all. Each endpoint answers in well under a second. A failed oEmbed falls back to the page.

type OEmbed = Record<string, unknown>

type Provider = {
  match: (url: URL) => boolean
  endpoint: string
  read: (body: OEmbed) => ParsedPage
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

/** The words of a small trusted-shape HTML fragment, such as a tweet's `<p>`. */
export function fragmentText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim()
}

const host = (url: URL) => url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "")

const PROVIDERS: readonly Provider[] = [
  {
    match: (url) =>
      (host(url) === "youtube.com" && /^\/(watch|shorts\/|live\/)/.test(url.pathname)) || host(url) === "youtu.be",
    endpoint: "https://www.youtube.com/oembed?format=json&url=",
    read: (body) => ({
      title: text(body.title),
      description: text(body.author_name),
      siteName: "YouTube",
      image: text(body.thumbnail_url),
      favicon: "https://www.youtube.com/favicon.ico",
    }),
  },
  {
    match: (url) => (host(url) === "x.com" || host(url) === "twitter.com") && /\/status\/\d+/.test(url.pathname),
    endpoint: "https://publish.x.com/oembed?omit_script=1&url=",
    read: (body) => {
      const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(text(body.html) ?? "")?.[1]
      return {
        title: text(body.author_name),
        description: paragraph ? fragmentText(paragraph).slice(0, 500) || undefined : undefined,
        siteName: "X",
        favicon: "https://abs.twimg.com/favicons/twitter.3.ico",
      }
    },
  },
]

/** The oEmbed URL for a page, or null when the page is read the ordinary way. */
export function oembedFor(pageUrl: string): { endpoint: string; read: Provider["read"] } | null {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }
  const provider = PROVIDERS.find((p) => p.match(url))
  return provider ? { endpoint: provider.endpoint + encodeURIComponent(pageUrl), read: provider.read } : null
}
