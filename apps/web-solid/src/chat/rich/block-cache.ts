import type { RichText } from "@kiko/protocol"
import { type ImageFile, parseRichText } from "@kiko/protocol/markdown"

type Fence = { char: string; length: number }

type BoundaryScan = {
  source: string
  length: number
  fence: Fence | undefined
  seen: boolean
  pending: number
  boundary: number
  poisoned: boolean
}

export type RichTextCache = { parse(markdown: string, imageFile?: ImageFile): RichText }

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LIST_MARKER = /^([-+*]|\d{1,9}[.)])([ \t]|$)/
const DEFINITION = /^ {0,3}\[[^\]]+\]:/m
const UNSAFE_HTML = /<(?:script|pre|style|textarea)\b|<!--|<\?|<![A-Z]|<!\[CDATA\[/i
const NO_IMAGE: ImageFile = () => null

const freshScan = (): BoundaryScan => ({
  source: "",
  length: 0,
  fence: undefined,
  seen: false,
  pending: -1,
  boundary: 0,
  poisoned: false,
})

function blank(text: string): boolean {
  return /^[ \t]*$/.test(text)
}

function fenceOf(text: string): Fence | undefined {
  const match = FENCE.exec(text)
  if (!match) return undefined
  const run = match[1]!
  if (run[0] === "`" && match[2]!.includes("`")) return undefined
  return { char: run[0]!, length: run.length }
}

function closesFence(text: string, fence: Fence): boolean {
  const match = CLOSING_FENCE.exec(text)
  return !!match && match[1]![0] === fence.char && match[1]!.length >= fence.length
}

function startsNewBlock(text: string): boolean {
  return text.length > 0 && !/^[ \t>]/.test(text) && !LIST_MARKER.test(text)
}

function scanBoundary(scan: BoundaryScan, source: string): number {
  if (!source.startsWith(scan.source)) Object.assign(scan, freshScan())
  scan.source = source
  if (scan.poisoned) return 0
  const fresh = source.slice(scan.length)
  if (DEFINITION.test(fresh) || UNSAFE_HTML.test(fresh)) {
    scan.poisoned = true
    return 0
  }
  const complete = fresh.lastIndexOf("\n") + 1
  let start = 0
  while (start < complete) {
    const newline = fresh.indexOf("\n", start)
    const text = fresh.slice(start, newline).replace(/\r$/, "")
    const end = scan.length + newline + 1
    start = newline + 1
    if (scan.fence) {
      if (closesFence(text, scan.fence)) scan.fence = undefined
      continue
    }
    if (blank(text)) {
      if (scan.pending < 0) scan.pending = end
      continue
    }
    if (scan.pending >= 0 && scan.seen && startsNewBlock(text)) scan.boundary = scan.pending
    scan.pending = -1
    const opener = fenceOf(text)
    if (opener) scan.fence = opener
    scan.seen = true
  }
  scan.length += complete
  return scan.boundary
}

export function createRichTextCache(): RichTextCache {
  let cachedSource = ""
  let cached: RichText = []
  let cachedImage: ImageFile | undefined
  const scan = freshScan()
  return {
    parse(markdown, imageFile = NO_IMAGE) {
      if (imageFile !== cachedImage) {
        cachedSource = ""
        cached = []
        cachedImage = imageFile
      }
      if (!markdown.startsWith(cachedSource)) {
        cachedSource = ""
        cached = []
      }
      const boundary = scanBoundary(scan, markdown)
      if (boundary < cachedSource.length) {
        cachedSource = ""
        cached = []
      }
      if (boundary > cachedSource.length) {
        cached = [...cached, ...parseRichText(markdown.slice(cachedSource.length, boundary), imageFile)]
        cachedSource = markdown.slice(0, boundary)
      }
      const tail = parseRichText(markdown.slice(cachedSource.length), imageFile)
      return cached.length ? [...cached, ...tail] : tail
    },
  }
}
