// Turning a message body into the spans inside it, ported from tweb's
// `src/lib/richTextProcessor/parseEntities.ts` (originally Igor Zhukov's
// webogram).
// The port keeps the original loop shape, because the loop IS the algorithm: the
// matcher is one alternation over the whole body, and the raw cursor is advanced
// past each match so the next `String.match` starts where the last one ended.
// It reads `match.groups`, never `match[n]` — the group table at the top of
// `regex.ts` explains why a positional read here is a trap.

import { EMAIL_REG_EXP, FULL_REG_EXP } from "./regex"
import { TLD } from "./tld"
import { checkBrackets } from "./url"

/** One span of the body, in body coordinates. `offset` is in UTF-16 units. */
export interface TextEntity {
  kind: "url" | "email" | "mention" | "hashtag"
  offset: number
  length: number
}

/**
 * The spans in `text`, in the order they appear.
 *
 * An offset/length pair rather than a matched substring, because the renderer
 * needs the body back byte-for-byte: `segments.ts` slices this and keeps the
 * gaps, and a span that carried its own text would let the two drift.
 *
 * A run the matcher claims but the rules below reject — `foo.bar`, a bare
 * scheme, a `$` shape — is simply absent from the result, and its characters
 * come back as prose. Nothing is dropped.
 */
export function parseEntities(text: string): TextEntity[] {
  let match: RegExpMatchArray | null
  let raw = text
  const entities: TextEntity[] = []
  let matchIndex: number
  let rawOffset = 0
  FULL_REG_EXP.lastIndex = 0
  while ((match = raw.match(FULL_REG_EXP)) !== null) {
    // `String.match` types `index` as optional because a global regexp match
    // array from `matchAll` need not carry it; a non-global `match` always
    // does. The `?? 0` is what lets the walk read it without a non-null
    // assertion that would hide a real miss.
    const at = match.index ?? 0
    matchIndex = rawOffset + at

    const groups = match.groups ?? {}

    if (groups.mentionBody) {
      // mentions
      entities.push({
        kind: "mention",
        // `mentionPrefix` is the `(^| )` the mention had to start after; the `@`
        // in `mentionAt` is the first character of the entity.
        offset: matchIndex + groups.mentionPrefix.length,
        length: groups.mentionAt.length + groups.mentionBody.length,
      })
    } else if (groups.url) {
      if (EMAIL_REG_EXP.test(groups.url)) {
        // an address is the same shape as a URL with a `user@` in front of it, so
        // the matcher cannot tell them apart and this whole-string test is what
        // does. Anchored both ends, which is why it is a discriminator.
        entities.push({
          kind: "email",
          offset: matchIndex,
          length: groups.url.length,
        })
      } else {
        // `url` is rewritten in place when `checkBrackets` finds the match was
        // over-long; the entity's length is read back off it, so the two cannot
        // disagree. Local rather than `match[4] = …` as tweb does, because a
        // named group is not writable after the fact.
        let url = groups.url
        let protocol = groups.protocol
        const tld = groups.tld
        if (tld) {
          // URL
          //
          // THE TLD GATE. A run with no protocol of its own is only a URL if
          // its last label is a real TLD (or a punycode one, which is how a
          // non-latin registry spells itself). Without the gate every
          // `something.something` in a sentence becomes an anchor, and a chat
          // full of accidental links reads as broken.
          if (!protocol && (tld.substr(0, 4) === "xn--" || TLD.indexOf(tld.toLowerCase()) !== -1)) {
            protocol = "http://"
          }

          if (protocol) {
            // the bracket was prose punctuation, so it is not part of the entity
            // and stays in the text run that follows
            url = checkBrackets(url)
          }
        } else {
          // IP address — no TLD to gate on, and an IPv4 literal is not ambiguous
        }

        // A host right after a slash is a file name inside a path, as in
        // `/plan/route.md`, where `.md` is also a TLD. Only a spelled-out
        // protocol makes it a link.
        const inPath = !groups.protocol && /[/\\]/.test(text[matchIndex - 1] ?? "")
        if ((protocol || !tld) && !inPath) {
          entities.push({
            kind: "url",
            offset: matchIndex,
            length: url.length,
          })
        }
      }
    } else if (groups.hashtag) {
      // hashtag. `tagPrefix` is the `(^|[\s(])` the tag had to start after; the
      // `#` is the first character of the entity.
      //
      // tweb accepted `\$[A-Z]{1,8}` here too and then discarded every cashtag
      // that was not already uppercase. Cashtags are not a thing in a yuki
      // transcript, so `TAG_REG_EXP` does not match a `$`-led run at all and
      // there is nothing left to reject.
      entities.push({
        kind: "hashtag",
        offset: matchIndex + groups.tagPrefix.length,
        length: groups.hashtag.length,
      })
    }

    // Advance past the WHOLE match, prefix character included — never by a fixed
    // step. The prefix (`^`, a space, an opening bracket) belongs to the run the
    // entity sat in, not to the entity, so `rawOffset` counts it and the
    // entity's own offset is computed from the prefix length above.
    raw = raw.substr(at + match[0].length)
    rawOffset += at + match[0].length
  }

  return entities
}
