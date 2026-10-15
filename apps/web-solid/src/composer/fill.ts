import { createRoot, createSignal } from "solid-js"

/*
 * Text another part of the app puts in a chat's composer, such as the bot picker's "New agent".
 * It waits here until that chat's composer takes it, so it lands whether the chat is open or not.
 */
type Fill = { roomId: string; text: string }

const [pending, setPending] = createRoot(() => createSignal<Fill | null>(null))

export const composerFill = pending

export function fillComposer(roomId: string, text: string): void {
  setPending({ roomId, text })
}

/** The text waiting for this chat, taken once. Undefined when nothing waits for it. */
export function takeComposerFill(roomId: string): string | undefined {
  const fill = pending()
  if (!fill || fill.roomId !== roomId) return undefined
  setPending(null)
  return fill.text
}
