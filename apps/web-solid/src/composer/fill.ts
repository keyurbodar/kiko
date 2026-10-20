import { createRoot, createSignal } from "solid-js"

type Fill = { roomId: string; text: string }

const [pending, setPending] = createRoot(() => createSignal<Fill | null>(null))

export const composerFill = pending

export function fillComposer(roomId: string, text: string): void {
  setPending({ roomId, text })
}

export function takeComposerFill(roomId: string): string | undefined {
  const fill = pending()
  if (!fill || fill.roomId !== roomId) return undefined
  setPending(null)
  return fill.text
}
