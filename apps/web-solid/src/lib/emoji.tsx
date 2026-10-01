import { For, Show, type JSX } from "solid-js"
import { cn } from "./cn"

/**
 * Twemoji, as static artwork.
 *
 * The artwork is not a dependency and it is not in the initial payload. The
 * SVGs live under `public/emoji/`, named by Twemoji's own convention, and are
 * served one file per emoji on demand. Opening the transcript downloads none of
 * it; a reaction chip downloads exactly one file; the picker downloads only the
 * cells the reader has actually scrolled to, because the browser's image cache
 * covers the rest on the way back. Installing `@twemoji/api` would mean either a
 * CDN - where an offline machine shows no emoji at all - or bundling 18MB of
 * artwork into the load.
 *
 * The filename is the emoji's code points, lower-case hex, joined with `-`,
 * with the VARIATION SELECTOR-16 (`fe0f`) dropped because Twemoji ships no such
 * file. A ZWJ sequence keeps its `200d`, so a multi-person emoji resolves to one
 * file rather than to two half-pictures.
 */

const VARIATION_SELECTORS: Record<string, true> = { fe0e: true, fe0f: true }

const codePoints = (emoji: string) =>
  Array.from(emoji)
    .map((character) => character.codePointAt(0)?.toString(16))
    .filter((point): point is string => point !== undefined)

/** A filename from the code points, with the variation selectors kept or dropped. */
function twemojiSpelling(points: readonly string[], keepSelectors: boolean) {
  const kept = keepSelectors
    ? points
    : points.filter((point) => VARIATION_SELECTORS[point] === undefined)
  return kept.length > 0 ? kept.join("-") : undefined
}

/**
 * Both spellings Twemoji might have used, best guess first.
 *
 * Twemoji keeps the variation selector inside a ZWJ sequence and drops it
 * outside one: `❤️‍🔥` ships as `2764-fe0f-200d-1f525.svg` while a lone `❤️`
 * ships as `2764.svg`, with no selector at all.
 *
 * That rule is the best guess and not the answer, because the asset set does not
 * always obey it: `👁️‍🗨️` ships as `1f441-200d-1f5e8.svg` with BOTH selectors
 * dropped, which nothing about the character predicts. So the caller loads the
 * first spelling and, if the file is missing, tries the second before falling
 * back to the platform glyph — one extra request for the handful of sequences
 * that disagree, and none for the thousands that do not.
 */
export function twemojiCandidates(emoji: string): readonly string[] {
  const points = codePoints(emoji)
  const joined = emoji.includes("\u200d")
  const primary = twemojiSpelling(points, joined)
  if (primary === undefined) return []
  const alternate = twemojiSpelling(points, !joined)
  return alternate === undefined || alternate === primary ? [primary] : [primary, alternate]
}

/** The URLs to try for one emoji, in order. */
export function twemojiSources(emoji: string): readonly string[] {
  return twemojiCandidates(emoji).map((file) => `/emoji/${file}.svg`)
}

/** A stretch of a message body: either plain text, or one emoji to draw. */
export interface EmojiRun {
  text: string
  emoji?: string
}

/**
 * The `RGI_Emoji` matcher, built once. `v` mode is what makes it match a whole
 * grapheme — a flag, a skin tone, a ZWJ family — rather than a code point at a
 * time; splitting those would draw three unrelated pictures where there should
 * be one. An engine without it has no artwork substitution, which is a degraded
 * body rather than a broken one.
 */
let emojiPattern: RegExp | undefined | null = null
function pattern(): RegExp | undefined {
  if (emojiPattern === null) {
    try {
      emojiPattern = new RegExp("\\p{RGI_Emoji}", "gv")
    } catch {
      emojiPattern = undefined
    }
  }
  return emojiPattern ?? undefined
}

/**
 * A message body split into plain text and emoji, in order.
 *
 * The `text` of every run is always present so a caller can render the string
 * verbatim when it does not want artwork; `emoji` marks the runs that are one
 * whole emoji and nothing else.
 */
export function emojiSegments(text: string): readonly EmojiRun[] {
  const matcher = pattern()
  if (matcher === undefined) return [{ text }]
  const runs: EmojiRun[] = []
  let cursor = 0
  for (const match of text.matchAll(matcher)) {
    const at = match.index ?? 0
    if (at > cursor) runs.push({ text: text.slice(cursor, at) })
    runs.push({ text: match[0], emoji: match[0] })
    cursor = at + match[0].length
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) })
  return runs
}

/**
 * A message body with its emoji drawn as artwork and everything else untouched.
 *
 * Sized in `em` rather than pixels on purpose: a body that is entirely emoji is
 * set at 49px or 35px by the jumbo utility, and an `em` box rides that scale
 * without the renderer knowing anything about it.
 */
export function EmojiText(props: { text: string; class?: string }): JSX.Element {
  return (
    <For each={emojiSegments(props.text)}>
      {(run) => (
        <Show when={run.emoji} fallback={<>{run.text}</>}>
          {(emoji) => (
            <Emoji
              emoji={emoji()}
              class={cn("inline-block size-[1.1em] align-[-0.15em]", props.class)}
            />
          )}
        </Show>
      )}
    </For>
  )
}

/**
 * One emoji, drawn as artwork.
 *
 * `loading="lazy"` is what makes the whole set affordable: the browser only
 * fetches files for emoji that are actually near the viewport, so a chat with
 * three hundred distinct emoji costs three hundred small files across the whole
 * scroll rather than three hundred on first paint.
 *
 * A filename is a guess at Twemoji's own naming, and the asset set disagrees
 * with its rule in a handful of places, so a miss walks to the next spelling
 * before giving up. Once the spellings are exhausted the character replaces the
 * image: a missing file is a missing glyph, and drawing the glyph the platform
 * does have is the honest outcome; a broken-image box is not.
 */
export function Emoji(props: {
  emoji: string
  class?: string
  /** Overrides the accessible name. Defaults to announcing the emoji itself. */
  title?: string
  style?: JSX.CSSProperties
  /** Opt out of lazy loading for an emoji that is known to be above the fold. */
  eager?: boolean
}): JSX.Element {
  return (
    <img
      src={twemojiSources(props.emoji)[0]}
      alt={props.title ?? props.emoji}
      title={props.title}
      class={props.class}
      style={props.style}
      loading={props.eager === true ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={(event) => {
        const image = event.currentTarget
        const attempt = Number(image.dataset.attempt ?? "0") + 1
        const next = twemojiSources(props.emoji)[attempt]
        if (next !== undefined) {
          image.dataset.attempt = String(attempt)
          image.src = next
          return
        }
        image.replaceWith(document.createTextNode(props.emoji))
      }}
    />
  )
}
