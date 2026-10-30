import { createSignal, type JSX } from "solid-js"
import {
  clampExplorerWidth,
  EXPLORER_MAX,
  EXPLORER_MIN,
  EXPLORER_STEP,
  readExplorerWidth,
  saveExplorerWidth,
} from "./resize"
import "./explorer.css"

export function FileExplorerPane(props: { rowWidth: number; children: JSX.Element }): JSX.Element {
  const [width, setWidth] = createSignal(readExplorerWidth())
  const [dragging, setDragging] = createSignal(false)
  let start: { x: number; width: number } | null = null

  const bound = () => Math.max(EXPLORER_MIN, Math.min(EXPLORER_MAX, props.rowWidth - 256))
  const shown = () => clampExplorerWidth(width(), props.rowWidth)

  const commit = (next: number) => {
    const value = clampExplorerWidth(next, props.rowWidth)
    setWidth(value)
    saveExplorerWidth(value)
  }

  const resize = (next: number) => setWidth(clampExplorerWidth(next, props.rowWidth))

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    start = { x: event.clientX, width: shown() }
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!start) return
    resize(start.width + (start.x - event.clientX))
  }

  const onPointerUp = () => {
    if (!start) return
    start = null
    setDragging(false)
    saveExplorerWidth(shown())
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const key = event.key
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return
    event.preventDefault()
    event.stopPropagation()
    const next = {
      ArrowLeft: () => shown() + EXPLORER_STEP,
      ArrowRight: () => shown() - EXPLORER_STEP,
      Home: () => EXPLORER_MIN,
      End: () => bound(),
    }[key]()
    commit(next)
  }

  return (
    <aside
      class="relative flex min-h-0 min-w-0 shrink-0 flex-col"
      aria-label="File explorer"
      data-component="file-explorer-pane"
      style={{ width: `${shown()}px` }}
    >
      <div
        role="separator"
        aria-label="Resize file explorer"
        aria-orientation="vertical"
        aria-valuenow={shown()}
        aria-valuemin={EXPLORER_MIN}
        aria-valuemax={bound()}
        tabIndex={0}
        class="fe-handle"
        data-dragging={dragging() ? "" : undefined}
        data-component="file-explorer-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">{props.children}</div>
    </aside>
  )
}
