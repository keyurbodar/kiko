import type { RichText } from "@kiko/protocol"
import { type ImageFile, parseRichText } from "@kiko/protocol/markdown"

type SourceLine = { text: string; end: number }
type Fence = { char: string; length: number }

export type RichTextCache = { parse(markdown: string, imageFile?: ImageFile): RichText }

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LIST_MARKER = /^([-+*]|\d{1,9}[.)])([ \t]|$)/
const DEFINITION = /^ {0,3}\[[^\]]+\]:/m
const UNSAFE_HTML = /<(?:script|pre|style|textarea)\b|<!--|<\?|<![A-Z]|<!\[CDATA\[/i
const NO_IMAGE: ImageFile = () => null

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  while (start < source.length) {
    const newline = source.indexOf("\n", start)
    if (newline === -1) {
      lines.push({ text: source.slice(start).replace(/\r$/, ""), end: source.length })
      break
    }
    lines.push({ text: source.slice(start, newline).replace(/\r$/, ""), end: newline + 1 })
    start = newline + 1
  }
  return lines
}

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

function stableBoundary(source: string): number {
  if (DEFINITION.test(source) || UNSAFE_HTML.test(source)) return 0
  const lines = sourceLines(source)
  let fence: Fence | undefined
  let previous = -1
  let pending = -1
  let boundary = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (fence) {
      if (closesFence(line.text, fence)) fence = undefined
      continue
    }
    if (blank(line.text)) {
      if (pending < 0) pending = line.end
      continue
    }
    if (pending >= 0 && previous >= 0 && startsNewBlock(line.text)) boundary = pending
    pending = -1
    const opener = fenceOf(line.text)
    if (opener) fence = opener
    previous = index
  }
  return boundary
}

export function createRichTextCache(): RichTextCache {
  let cachedSource = ""
  let cached: RichText = []
  let cachedImage: ImageFile | undefined
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
      const boundary = stableBoundary(markdown)
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
