// URL cleanup, ported from tweb's `src/lib/richTextProcessor/checkBrackets.ts`
// and `src/lib/richTextProcessor/matchUrlProtocol.ts` (originally Igor Zhukov's
// webogram).
//
// Both of these run on a run of text that is already known to be a URL, and both
// exist because the thing that reads the URL afterwards — a browser, an anchor's
// `href` — is more literal than the regex that found it.

// The protocols that must never survive as a navigable href. `javascript:` runs
// the sender's string in the reader's session the moment the link is followed,
// and there is no version of "the user meant well by that" worth preserving.
const SKIP_PROTOCOLS: Set<string> = new Set(["javascript:"])

/**
 * Trim a run's unbalanced trailing brackets, so prose punctuation stays out of
 * the link.
 *
 * A URL pattern cannot tell the `)` that ends a Wikipedia title from the `)`
 * that ends the sentence around it, so it takes both. This walks the imbalance
 * back off the end: while there are more closers than openers and the last
 * character is `)`, drop one — then, if openers are still ahead of closers, drop
 * every closer left on the end. What comes back is always the longest prefix of
 * the input whose brackets balance, which for `(see https://example.com/x)` is
 * `https://example.com/x`.
 */
export function checkBrackets(url: string): string {
  let urlLength = url.length
  let urlOpenBrackets = url.split("(").length - 1
  let urlCloseBrackets = url.split(")").length - 1
  while (urlCloseBrackets > urlOpenBrackets && url.charAt(urlLength - 1) === ")") {
    url = url.substr(0, urlLength - 1)
    urlCloseBrackets--
    urlLength--
  }
  if (urlOpenBrackets > urlCloseBrackets) {
    url = url.replace(/\)+$/, "")
  }
  return url
}

// Reads the protocol off the TEXT, the way the url parser does before it
// validates anything else: tabs and newlines are dropped wherever they sit and
// leading C0/space is skipped, so `java\nscript:` and ` javascript:` are the same
// protocol to a browser and have to be the same one here.
const STRIPPED_REG_EXP = /[\t\n\r]/g
const PROTOCOL_REG_EXP = /^[\x00-\x20]*([a-z][a-z\d+\-.]*):/i
function matchUrlProtocolText(text: string): string | false {
  const match = text?.replace(STRIPPED_REG_EXP, "").match(PROTOCOL_REG_EXP)
  return match ? match[1].toLowerCase() + ":" : false
}

/**
 * The href a matched run should actually navigate to.
 *
 * A run with no protocol of its own is meant as an ordinary https one, so it gets
 * `https://`. A `javascript:` payload must never survive as a navigable url, and
 * it is not enough to refuse to prefix it: the run has to end up somewhere, and
 * an unprefixed `javascript:` href is exactly the thing that runs. So it ends up
 * as https too.
 *
 * A run that spells any OTHER protocol is handed back untouched even when the
 * parser will reject it (`https://t.me:99999/x`, a port out of range):
 * prefixing that one builds `https://https://…`, which is neither the link that
 * was written nor a link at all. And it is still marked suspicious downstream —
 * `isSuspiciousUrl` reads the real host either way.
 */
export function normalizeUrlProtocol(url: string): string {
  const protocol = matchUrlProtocolText(url)
  return protocol && !SKIP_PROTOCOLS.has(protocol) ? url : "https://" + url
}
