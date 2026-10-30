import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { room } from "../../state/room"
import ThreadDetails from "./thread-details"
import { setThreadDetailsOpen, threadDetailsOpen } from "./thread-details-state"
import "./thread-details.css"

const isDesktop = () => typeof matchMedia !== "function" || matchMedia("(width >= 960px)").matches

const hasHistory = (chatId: string): boolean => {
  const row = room.chatById(chatId)
  return row !== undefined && (row.lastFrom !== undefined || row.preview !== "")
}

const defaultOpen = (chatId: string): boolean => isDesktop() && hasHistory(chatId)

const [floating, setFloating] = createSignal(false)
const [popped, setPopped] = createSignal<string | null>(null)

export function setThreadDetailsFloating(value: boolean) {
  if (value === floating()) return
  setPopped(null)
  setFloating(value)
}

export function threadDetailsOpenFor(chatId: string | null): boolean {
  if (chatId === null) return false
  return floating() ? popped() === chatId : threadDetailsOpen(chatId, defaultOpen(chatId))
}

export function toggleThreadDetails(chatId: string) {
  if (floating()) setPopped(popped() === chatId ? null : chatId)
  else setThreadDetailsOpen(chatId, !threadDetailsOpenFor(chatId))
}

const closeThreadDetails = (chatId: string) => {
  if (floating()) setPopped(null)
  else setThreadDetailsOpen(chatId, false)
}

const headerRect = (): DOMRect | undefined =>
  document.querySelector<HTMLElement>('[data-component="top-bar"]')?.getBoundingClientRect()

export default function ThreadDetailsLayer(props: { chatId: string; inline: boolean }) {
  const [anchor, setAnchor] = createSignal<DOMRect | null>(null)
  const open = () => threadDetailsOpenFor(props.chatId)
  const popover = () => !props.inline
  const place = () => setAnchor(headerRect() ?? null)
  onMount(() => {
    place()
    window.addEventListener("resize", place)
    const canvas = document.querySelector('[data-component="main-panel"]')
    const observer = canvas && typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : undefined
    if (canvas) observer?.observe(canvas)
    onCleanup(() => {
      window.removeEventListener("resize", place)
      observer?.disconnect()
    })
  })
  createEffect(() => {
    if (!open() || !popover()) return
    place()
    const close = () => closeThreadDetails(props.chatId)
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
            "--td-top": `${anchor()?.bottom ?? 60}px`,
            top: `${anchor()?.bottom ?? 60}px`,
            right: `${window.innerWidth - (anchor()?.right ?? window.innerWidth) + 12}px`,
          }}
        >
          <ThreadDetails chatId={props.chatId} />
        </div>
      </Show>
    </Show>
  )
}
