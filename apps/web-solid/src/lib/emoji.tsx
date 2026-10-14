import { For, Show, type JSX } from "solid-js"

/**
 * Emoji are the platform's own glyphs, set as text in the emoji font stack
 * (`font-emoji`). Nothing is downloaded to draw one.
 */

/** A stretch of a message body: either plain text, or one emoji. */
export interface EmojiRun {
  text: string
  emoji?: string
}

/**
 * The `RGI_Emoji` matcher, built once. `v` mode matches a whole grapheme, so a
 * flag, a skin tone or a ZWJ family stays one run. An engine without it gets the
 * body as one plain run.
 */
let emojiPattern: RegExp | undefined | null = null
function pattern(): RegExp | undefined {
  if (emojiPattern === null) {
    try {
      emojiPattern = /\p{RGI_Emoji}/gv
    } catch {
      emojiPattern = undefined
    }
  }
  return emojiPattern ?? undefined
}

/** A message body split into plain text and emoji, in order. */
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
 * A message body with its emoji set in the emoji font. The interface font may be
 * serif or mono, and either can hold a text-style glyph for a heart or a digit
 * keycap, so each emoji names the color font itself.
 */
export function EmojiText(props: { text: string }): JSX.Element {
  return (
    <For each={emojiSegments(props.text)}>
      {(run) => (
        <Show when={run.emoji} fallback={<>{run.text}</>}>
          {(emoji) => <span class="font-emoji">{emoji()}</span>}
        </Show>
      )}
    </For>
  )
}
