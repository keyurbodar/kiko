import { EMAIL_REG_EXP, FULL_REG_EXP } from "./regex"
import { TLD } from "./tld"
import { checkBrackets } from "./url"

export interface TextEntity {
  kind: "url" | "email" | "mention" | "hashtag"
  offset: number
  length: number
}

export function parseEntities(text: string): TextEntity[] {
  let match: RegExpMatchArray | null
  let raw = text
  const entities: TextEntity[] = []
  let matchIndex: number
  let rawOffset = 0
  FULL_REG_EXP.lastIndex = 0
  while ((match = raw.match(FULL_REG_EXP)) !== null) {
    const at = match.index ?? 0
    matchIndex = rawOffset + at

    const groups = match.groups ?? {}

    if (groups.mentionBody) {
      entities.push({
        kind: "mention",
        offset: matchIndex + groups.mentionPrefix.length,
        length: groups.mentionAt.length + groups.mentionBody.length,
      })
    } else if (groups.url) {
      if (EMAIL_REG_EXP.test(groups.url)) {
        entities.push({
          kind: "email",
          offset: matchIndex,
          length: groups.url.length,
        })
      } else {
        addUrl(entities, groups, text, matchIndex)
      }
    } else if (groups.hashtag) {
      entities.push({
        kind: "hashtag",
        offset: matchIndex + groups.tagPrefix.length,
        length: groups.hashtag.length,
      })
    }

    raw = raw.substr(at + match[0].length)
    rawOffset += at + match[0].length
  }

  return entities
}

function addUrl(entities: TextEntity[], groups: Record<string, string>, text: string, matchIndex: number): void {
  let url = groups.url
  let protocol = groups.protocol
  const tld = groups.tld
  if (tld) {
    if (!protocol && (tld.substr(0, 4) === "xn--" || TLD.indexOf(tld.toLowerCase()) !== -1)) {
      protocol = "http://"
    }

    if (protocol) {
      url = checkBrackets(url)
    }
  }

  const inPath = !groups.protocol && /[/\\]/.test(text[matchIndex - 1] ?? "")
  if ((protocol || !tld) && !inPath) {
    entities.push({
      kind: "url",
      offset: matchIndex,
      length: url.length,
    })
  }
}
