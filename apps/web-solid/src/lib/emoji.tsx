import { For, Show, type JSX } from "solid-js"

export interface EmojiRun {
  text: string
  emoji?: string
}

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
