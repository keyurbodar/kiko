const MAX_CHUNK_LENGTH = 16 * 1024

const HISTORY_LINES = 5_000
const HISTORY_BYTES = 8 * 1024 * 1024

type Chunk = { data: string; byteLength: number; lineBreaks: number }

export class BoundedHistory {
  private chunks: Array<Chunk | undefined> = []
  private start = 0
  private byteLength = 0
  private lineBreaks = 0
  private lastCodeUnit: number | undefined
  private cached: string | null = ""

  constructor(
    private readonly maxLines = HISTORY_LINES,
    private readonly maxBytes = HISTORY_BYTES,
  ) {}

  append(text: string): void {
    if (text.length === 0) return
    this.cached = null
    if (this.maxBytes <= 0 || this.maxLines <= 0) {
      this.clear()
      return
    }
    let offset = this.joinSplitSurrogate(text)
    while (offset < text.length) {
      let end = Math.min(offset + MAX_CHUNK_LENGTH, text.length)
      const before = text.charCodeAt(end - 1)
      const after = text.charCodeAt(end)
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1
      const data = text.slice(offset, end)
      this.pushChunk(text.length > MAX_CHUNK_LENGTH ? Buffer.from(data, "utf16le").toString("utf16le") : data)
      this.trim()
      offset = end
    }
  }

  private joinSplitSurrogate(text: string): number {
    const previous = this.chunks.at(-1)
    const last = this.lastCodeUnit
    const first = text.charCodeAt(0)
    if (previous && last !== undefined && last >= 0xd800 && last <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) {
      previous.data += text[0]
      previous.byteLength += 1
      this.byteLength += 1
      this.lastCodeUnit = first
      this.trim()
      return 1
    }
    return 0
  }

  private pushChunk(data: string): void {
    const byteLength = Buffer.byteLength(data)
    const lineBreaks = countLineBreaks(data)
    const previous = this.chunks.at(-1)
    if (previous && previous.data.length + data.length <= MAX_CHUNK_LENGTH) {
      previous.data += data
      previous.byteLength += byteLength
      previous.lineBreaks += lineBreaks
    } else {
      this.chunks.push({ data, byteLength, lineBreaks })
    }
    this.byteLength += byteLength
    this.lineBreaks += lineBreaks
    this.lastCodeUnit = data.charCodeAt(data.length - 1)
    this.cached = null
  }

  private discard(): void {
    const first = this.chunks[this.start]
    if (!first) return
    this.byteLength -= first.byteLength
    this.lineBreaks -= first.lineBreaks
    this.chunks[this.start++] = undefined
  }

  private trimStart(offset: number, bytes: number, lines: number): void {
    const first = this.chunks[this.start]
    if (!first) return
    if (offset >= first.data.length) {
      this.discard()
      return
    }
    first.data = first.data.slice(offset)
    first.byteLength -= bytes
    first.lineBreaks -= lines
    this.byteLength -= bytes
    this.lineBreaks -= lines
  }

  private trim(): void {
    this.trimLines()
    this.trimBytes()
    if (this.start === this.chunks.length || (this.start > 2_048 && this.start * 2 >= this.chunks.length)) {
      this.chunks = this.chunks.slice(this.start)
      this.start = 0
      if (this.chunks.length === 0) this.lastCodeUnit = undefined
    }
  }

  private trimLines(): void {
    const trailingNewline = this.lastCodeUnit === 10
    let drop = this.lineBreaks + (trailingNewline ? 0 : 1) - this.maxLines
    while (drop > 0) {
      const first = this.chunks[this.start]
      if (!first) return
      if (first.lineBreaks < drop) {
        drop -= first.lineBreaks
        this.discard()
        continue
      }
      let offset = 0
      for (let line = 0; line < drop; line += 1) offset = first.data.indexOf("\n", offset) + 1
      this.trimStart(offset, Buffer.byteLength(first.data.slice(0, offset)), drop)
      drop = 0
    }
  }

  private trimBytes(): void {
    while (this.byteLength > this.maxBytes) {
      const first = this.chunks[this.start]
      if (!first) return
      const excess = this.byteLength - this.maxBytes
      if (first.byteLength <= excess) {
        this.discard()
        continue
      }
      if (first.byteLength === first.data.length && first.lineBreaks === 0) {
        this.trimStart(excess, excess, 0)
        continue
      }
      let offset = 0
      let bytes = 0
      let lines = 0
      while (bytes < excess) {
        const codePoint = first.data.codePointAt(offset) ?? 0
        bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
        offset += codePoint <= 0xffff ? 1 : 2
        if (codePoint === 10) lines += 1
      }
      this.trimStart(offset, bytes, lines)
    }
  }

  clear(): void {
    this.chunks = []
    this.start = 0
    this.byteLength = 0
    this.lineBreaks = 0
    this.lastCodeUnit = undefined
    this.cached = ""
  }

  value(): string {
    if (this.cached !== null) return this.cached
    const chunks: string[] = []
    for (let index = this.start; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index]
      if (chunk) chunks.push(chunk.data)
    }
    this.cached = chunks.join("")
    return this.cached
  }

  lines(count: number): { text: string; truncated: boolean } {
    const all = this.value()
    const parts = all.split("\n")
    const trailing = all.endsWith("\n") ? 1 : 0
    const total = Math.max(0, parts.length - trailing)
    if (total <= count) return { text: all, truncated: false }
    return { text: parts.slice(total - count).join("\n"), truncated: true }
  }
}

function countLineBreaks(data: string): number {
  let count = 0
  for (let index = data.indexOf("\n"); index !== -1; index = data.indexOf("\n", index + 1)) count += 1
  return count
}
