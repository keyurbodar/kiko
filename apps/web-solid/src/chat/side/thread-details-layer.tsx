import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { room } from "../../state/room"
import ThreadDetails from "./thread-details"
import { setThreadDetailsOpen, threadDetailsOpen } from "./thread-details-state"
import "./thread-details.css"

const isDesktop = () => typeof matchMedia !== "function" || matchMedia("(width >= 960px)").matches

const defaultOpen = (): boolean => isDesktop() && room.messages().length > 0

export function threadDetailsOpenFor(chatId: string | null): boolean {
  return chatId !== null && threadDetailsOpen(chatId, defaultOpen())
}

export function toggleThreadDetails(chatId: string) {
  setThreadDetailsOpen(chatId, !threadDetailsOpenFor(chatId))
}

const buttonRect = (): DOMRect | undefined =>
  document.querySelector<HTMLElement>('[data-action="toggle-thread-details"]')?.getBoundingClientRect()

export default function ThreadDetailsLayer(props: { chatId: string; inline: boolean }) {
  const [anchor, setAnchor] = createSignal<DOMRect | null>(null)
  const open = () => threadDetailsOpen(props.chatId, defaultOpen())
  const popover = () => !props.inline
  const place = () => setAnchor(buttonRect() ?? null)
  onMount(() => {
    place()
    window.addEventListener("resize", place)
    onCleanup(() => window.removeEventListener("resize", place))
  })
  createEffect(() => {
    if (!open() || !popover()) return
    place()
    const close = () => setThreadDetailsOpen(props.chatId, false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close()
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-component="thread-details"]')) return
      if (target.closest('[data-action="toggle-thread-details"]')) return
      if (target.closest('[role="menu"]')) return
      close()
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onDown, true)
    onCleanup(() => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onDown, true)
    })
  })
  return (
    <Show when={open()}>
      <Show
        when={popover()}
        fallback={
          <div class="td-inline td-enter" data-mode="inline">
            <ThreadDetails chatId={props.chatId} />
          </div>
        }
      >
        <div
          class="td-pop td-enter"
          data-mode="popover"
          style={{
            top: `${(anchor()?.bottom ?? 60) + 8}px`,
            right: `${Math.max(8, window.innerWidth - (anchor()?.right ?? window.innerWidth - 12))}px`,
          }}
        >
          <ThreadDetails chatId={props.chatId} />
        </div>
      </Show>
    </Show>
  )
}
