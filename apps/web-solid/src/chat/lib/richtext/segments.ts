// The renderer-facing view of a message body: an ordered, gap-free, lossless
// list of runs. Built on `parseEntities`; the rules for what each run links to
// live here, not in the parser, because they are presentation decisions.

import { parseEntities, type TextEntity } from "./parseEntities"
import isSuspiciousUrl from "./suspicious"
import { normalizeUrlProtocol } from "./url"

/**
 * One run of a message body, in reading order.
 *
 * `href` is present on exactly the runs that navigate — `url` and `email` — and
 * absent on `text`, `mention` and `hashtag`. A mention and a hashtag are prose
 * the sender typed, not places to go: rendering either as an anchor underlines
 * something the reader cannot act on, and a mailto link on a bubble reads as a
 * misparse of the sender's prose.
 *
 * `suspicious` is set only on a `url`, and only when the visible host and the
 * real one disagree. The renderer drops the `href` for those, so the link is
 * inert until somebody has been told where it goes.
 */
export type RichSegment = {
  text: string
  kind: "text" | "url" | "email" | "mention" | "hashtag"
  href?: string
  suspicious?: boolean
}

/**
 * Split a body into the runs the renderer walks.
 *
 * THE INVARIANT: joining every `segment.text` reproduces `text` exactly. The
 * gaps between entities are emitted as `text` runs rather than dropped, so
 * nothing a sender typed can disappear because a matcher claimed a neighbour of
 * it. `segments.test.ts` asserts this on every case it renders.
 *
 * Entities come back from the parser already in order, but they are sorted
 * anyway: the walk below is only correct on a sorted list, and a sort of a
 * handful of spans costs nothing next to the mistake it forecloses.
 *
 * Two entities may only claim overlapping characters when the matcher produced
 * them on different branches, which it does not — but the walk does not assume
 * that. The earlier one wins, and the later one is dropped rather than
 * emitting text twice: a duplicate is a visible repeat of a word the sender
 * wrote once.
 */
export function richTextSegments(text: string): RichSegment[] {
  if (!text) return []

  const entities = [...parseEntities(text)].sort((a, b) => a.offset - b.offset)

  const segments: RichSegment[] = []
  let cursor = 0

  for (const entity of entities) {
    // Overlap, or a zero-length claim: nothing to emit either way, and emitting
    // the entity would re-print characters the walk has already passed.
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

/**
 * One entity's href, decided per kind.
 *
 * `suspicious` is computed here rather than in the parser because it is only
 * meaningful for something that is about to become an `href`: a mention or a
 * hashtag has no destination, so there is nothing to be a homograph for.
 */
function entitySegment(entity: TextEntity, rawText: string): RichSegment {
  if (entity.kind === "url") {
    // Normalized through the same path the browser would take, so the run's
    // `href` and the host `isSuspiciousUrl` judges are the same host. A
    // `javascript:` payload is normalized to https here rather than refused, and
    // the href that comes out is never `javascript:`.
    const href = normalizeUrlProtocol(rawText)
    return { text: rawText, kind: "url", href, suspicious: isSuspiciousUrl(href) }
  }

  if (entity.kind === "email") {
    return { text: rawText, kind: "email", href: "mailto:" + rawText }
  }

  return { text: rawText, kind: entity.kind }
}
