import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import { htmlToText } from "@kiko/durable/html-text"
import { type Fetcher, safeFetch } from "@kiko/durable/safe-fetch"
import { defaultFetcher } from "../../lib/dev-fixture-fetch"
import type { RoomFs } from "../../files/room-fs"
import { spill } from "./spill"

export const WEB = "web"

const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml|javascript|ld\+json|rss\+xml|atom\+xml)\b)/

const text = (value: string) => [{ type: "text" as const, text: value }]

// Wikipedia and other sites answer 403 to a request with no user agent.
export const USER_AGENT = "Kiko/1.0 (web_fetch)"

export function webExtension(fetcher?: Fetcher, fs?: RoomFs): Extension {
  const fetch = fetcher ?? defaultFetcher()
  const webFetch = defineTool({
    name: "web_fetch",
    description: "fetch a public web page and return it as plain text.",
    parameters: Type.Object({ url: Type.String({ description: "an http or https url" }) }),
    replay: "safe",
    execute: async (args) => {
      const page = await safeFetch(args.url, fetch, { userAgent: USER_AGENT })
      if (!page.ok) return { output: text(`could not fetch ${page.url}: ${page.reason}`), isError: true }
      const details = { source: page.url }
      const type = (page.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
      if (type && !TEXT_TYPES.test(type)) {
        return { output: text(`${page.url} answered ${page.status} with ${type}, which is not text`), isError: true, details }
      }
      const raw = new TextDecoder().decode(page.body)
      const body = type === "text/html" || type === "application/xhtml+xml" || (!type && /<html\b/i.test(raw)) ? htmlToText(raw) : raw
      const head = `${page.url} (status ${page.status})${page.truncated ? ", cut at 1 mb" : ""}\n\n`
      return { output: text(head + (await spill(fs, page.url, body))), isError: page.status >= 400, details }
    },
  })
  return defineExtension({ name: WEB, tools: [declareEffect("read", webFetch)] })
}
