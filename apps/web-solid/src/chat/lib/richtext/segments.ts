import { parseEntities, type TextEntity } from "./parseEntities"
import isSuspiciousUrl from "./suspicious"
import { normalizeUrlProtocol } from "./url"

export type RichSegment = {
  text: string
  kind: "text" | "url" | "email" | "mention" | "hashtag"
  href?: string
  suspicious?: boolean
}

export function richTextSegments(text: string): RichSegment[] {
  if (!text) return []

  const entities = [...parseEntities(text)].sort((a, b) => a.offset - b.offset)

  const segments: RichSegment[] = []
  let cursor = 0

  for (const entity of entities) {
    if (entity.offset < cursor || entity.length <= 0) continue

    if (entity.offset > cursor) {
      segments.push({ text: text.slice(cursor, entity.offset), kind: "text" })
    }

    const rawText = text.slice(entity.offset, entity.offset + entity.length)
    cursor = entity.offset + entity.length

    segments.push(entitySegment(entity, rawText))
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), kind: "text" })
  }

  return segments
}

function entitySegment(entity: TextEntity, rawText: string): RichSegment {
  if (entity.kind === "url") {
    const href = normalizeUrlProtocol(rawText)
    return { text: rawText, kind: "url", href, suspicious: isSuspiciousUrl(href) }
  }

  if (entity.kind === "email") {
    return { text: rawText, kind: "email", href: "mailto:" + rawText }
  }

  return { text: rawText, kind: entity.kind }
}
