import { createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { clampPanelWidth, defaultWidth, INFO, panelMaxWidth, readWidth, writeWidth } from "./widths"

const KEY_STEP = 16

type Drag = { pointerId: number; startX: number; startWidth: number; pendingX: number; frame: number }

export function RightPanelHost(props: { maximized: boolean; children: JSX.Element }) {
  const [stored, setStored] = createSignal(readWidth(INFO))
  const [max, setMax] = createSignal(panelMaxWidth(window.innerWidth))
  const width = () => clampPanelWidth(stored(), max())
  const [dragging, setDragging] = createSignal(false)
  let host: HTMLDivElement | undefined
  let drag: Drag | null = null

  const commit = (next: number) => {
    const clamped = clampPanelWidth(Math.round(next), max())
    setStored(clamped)
    writeWidth(INFO, clamped)
  }

  const apply = (active: Drag) => {
    const next = clampPanelWidth(active.startWidth + (active.startX - active.pendingX), max())
    host?.style.setProperty("--panel-width", `${next}px`)
    return next
  }

  function finish(keep: boolean) {
    const active = drag
    if (!active) return
    drag = null
    cancelAnimationFrame(active.frame)
    const next = apply(active)
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    setDragging(false)
    if (keep) commit(next)
    else host?.style.setProperty("--panel-width", `${width()}px`)
  }

  const down: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0 || drag) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    event.preventDefault()
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width(), pendingX: event.clientX, frame: 0 }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    setDragging(true)
  }

  const move: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    const active = drag
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault()
    active.pendingX = event.clientX
    if (active.frame !== 0) return
    active.frame = requestAnimationFrame(() => {
      active.frame = 0
      apply(active)
    })
  }

  const up: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    const active = drag
    if (!active || active.pointerId !== event.pointerId) return
    active.pendingX = event.clientX
    finish(true)
  }

  const key: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const step = event.key === "ArrowLeft" ? KEY_STEP : event.key === "ArrowRight" ? -KEY_STEP : 0
    if (step === 0) return
    event.preventDefault()
    commit(width() + step)
  }

  onMount(() => {
    const row = host?.parentElement ?? null
    const measure = () => setMax(panelMaxWidth(window.innerWidth, row?.clientWidth))
    measure()
    let frame = 0
    const onResize = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    window.addEventListener("resize", onResize)
    const observer = row && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined
    if (row) observer?.observe(row)
    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(frame)
      observer?.disconnect()
      finish(false)
    })
  })

  return (
    <div
      ref={host}
      class="rp-host relative flex h-full min-h-0 min-w-0 max-w-full flex-col self-stretch"
      classList={{ "flex-1": props.maximized, "shrink-0": !props.maximized }}
      data-component="right-panel-host"
      data-maximized={props.maximized ? "true" : "false"}
      data-dragging={dragging() ? "" : undefined}
      style={{ "--panel-width": `${width()}px`, width: props.maximized ? "100%" : "var(--panel-width)" }}
    >
      {!props.maximized && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize side panel"
          aria-orientation="vertical"
          aria-valuenow={width()}
          aria-valuemin={INFO.min}
          aria-valuemax={max()}
          class="rp-resize"
          data-component="sidecar-resize"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => finish(false)}
          onLostPointerCapture={() => finish(true)}
          onKeyDown={key}
          onDblClick={() => commit(defaultWidth(INFO))}
        >
          <span aria-hidden="true" />
        </div>
      )}
      <div class="h-full min-h-0 w-full overflow-clip">
        <div
          class="flex h-full min-h-0 min-w-0 flex-col"
          style={props.maximized ? undefined : { width: "calc(var(--panel-width) - 1px)" }}
        >
          {props.children}
        </div>
      </div>
    </div>
  )
}
