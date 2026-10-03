import { createSignal, onCleanup, onMount, Show } from "solid-js"

/*
 * Quote a part of a message, as Telegram does. Select words in one bubble and a small "quote"
 * button appears above them; it arms a reply to that message carrying the selected words, which
 * the reply header shows and the agent reads as the part being answered. Loads after first paint.
 */

type Picked = { id: string; text: string; x: number; y: number }

/** ASSUMPTION: the longest quote. Longer selections answer the whole message instead. */
const MAX_QUOTE = 1000

const messageOf = (node: Node | null): Element | null => {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
  return el?.closest("[data-message-id]") ?? null
}

export default function QuoteOnSelect(props: { onQuote: (messageId: string, text: string) => void }) {
  const [picked, setPicked] = createSignal<Picked | null>(null)

  const read = () => {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return setPicked(null)
    const text = selection.toString().trim()
    const range = selection.getRangeAt(0)
    const message = messageOf(range.startContainer)
    const id = message?.getAttribute("data-message-id")
    // One bubble at a time, a stored message only, and nothing typed in an input.
    if (!text || text.length > MAX_QUOTE || !message || message !== messageOf(range.endContainer) || !id || id.startsWith("local:")) return setPicked(null)
    const rect = range.getBoundingClientRect()
    setPicked({ id, text, x: rect.left + rect.width / 2, y: rect.top })
  }

  onMount(() => {
    const later = () => requestAnimationFrame(read)
    const clearIfCollapsed = () => {
      if (document.getSelection()?.isCollapsed) setPicked(null)
    }
    document.addEventListener("pointerup", later)
    document.addEventListener("keyup", later)
    document.addEventListener("selectionchange", clearIfCollapsed)
    onCleanup(() => {
      document.removeEventListener("pointerup", later)
      document.removeEventListener("keyup", later)
      document.removeEventListener("selectionchange", clearIfCollapsed)
    })
  })

  return (
    <Show when={picked()}>
      {(p) => (
        <button
          type="button"
          class="fixed z-50 -translate-x-1/2 -translate-y-full rounded-full bg-btn px-3 py-1 text-sm text-text shadow-lg"
          style={{ left: `${p().x}px`, top: `${Math.max(8, p().y - 6)}px` }}
          data-action="quote-selection"
          // Keep the selection while the button is pressed.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            props.onQuote(p().id, p().text)
            document.getSelection()?.removeAllRanges()
            setPicked(null)
          }}
        >
          quote
        </button>
      )}
    </Show>
  )
}
