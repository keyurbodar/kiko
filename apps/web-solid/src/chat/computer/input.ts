import type { ComputerInput } from "@kiko/protocol"

export type Point = { x: number; y: number }

export type InputTarget = {
  stage: HTMLElement
  sink: HTMLTextAreaElement
  send(events: readonly ComputerInput[]): void
  onPointer(point: Point | null): void
}

const WHEEL_LINE = 40
const WHEEL_PAGE = 800

const clamp = (value: number) => Math.min(1, Math.max(0, value))

function pointOf(stage: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const rect = stage.getBoundingClientRect()
  return {
    x: rect.width ? clamp((event.clientX - rect.left) / rect.width) : 0,
    y: rect.height ? clamp((event.clientY - rect.top) / rect.height) : 0,
  }
}

function modsOf(event: KeyboardEvent): number {
  return (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0)
}

const isPasteChord = (event: KeyboardEvent) =>
  ((event.ctrlKey || event.metaKey) && event.code === "KeyV") || (event.shiftKey && event.code === "Insert")

function wheelScale(mode: number): number {
  if (mode === 1) return WHEEL_LINE
  return mode === 2 ? WHEEL_PAGE : 1
}

function pointerHandlers(target: InputTarget) {
  const { stage, sink, send, onPointer } = target
  const buttons = new Map<number, Point>()
  let pending: Point | null = null
  let frame = 0
  let last: Point = { x: 0, y: 0 }

  const flush = () => {
    frame = 0
    if (!pending) return
    send([{ k: "move", ...pending }])
    pending = null
  }
  const flushNow = () => {
    if (frame) cancelAnimationFrame(frame)
    flush()
  }

  return {
    move(event: PointerEvent) {
      last = pointOf(stage, event)
      onPointer(last)
      pending = last
      if (!frame) frame = requestAnimationFrame(flush)
    },
    down(event: PointerEvent) {
      event.preventDefault()
      stage.setPointerCapture(event.pointerId)
      sink.focus({ preventScroll: true })
      last = pointOf(stage, event)
      onPointer(last)
      flushNow()
      buttons.set(event.button, last)
      send([{ k: "down", ...last, b: event.button }])
    },
    up(event: PointerEvent) {
      last = pointOf(stage, event)
      flushNow()
      buttons.delete(event.button)
      send([{ k: "up", ...last, b: event.button }])
    },
    leave() {
      if (!buttons.size) onPointer(null)
    },
    wheel(event: WheelEvent) {
      event.preventDefault()
      const scale = wheelScale(event.deltaMode)
      send([{ k: "wheel", ...pointOf(stage, event), dx: event.deltaX * scale, dy: event.deltaY * scale }])
    },
    releaseAll() {
      flushNow()
      for (const [b, at] of buttons) send([{ k: "up", ...at, b }])
      buttons.clear()
      onPointer(null)
    },
  }
}

function keyHandlers(target: InputTarget) {
  const { sink, send } = target
  const down = new Map<string, { key: string; mods: number }>()

  const typed = (text: string) => {
    sink.value = ""
    if (text) send([{ k: "text", s: text }])
  }

  return {
    keydown(event: KeyboardEvent) {
      if (event.isComposing || event.key === "Process" || event.key === "Unidentified") return
      if (event.key === "Escape") return sink.blur()
      if (isPasteChord(event)) return
      event.preventDefault()
      const mods = modsOf(event)
      down.set(event.code, { key: event.key, mods })
      send([{ k: "key", code: event.code, key: event.key, down: true, mods }])
    },
    keyup(event: KeyboardEvent) {
      const held = down.get(event.code)
      if (!held) return
      event.preventDefault()
      down.delete(event.code)
      send([{ k: "key", code: event.code, key: held.key, down: false, mods: modsOf(event) }])
    },
    compositionend(event: CompositionEvent) {
      typed(event.data)
    },
    input(event: Event) {
      const { isComposing, data } = event as InputEvent
      if (isComposing) return
      typed(data ?? "")
    },
    paste(event: ClipboardEvent) {
      event.preventDefault()
      typed(event.clipboardData?.getData("text/plain") ?? "")
    },
    releaseAll() {
      for (const [code, held] of down) send([{ k: "key", code, key: held.key, down: false, mods: 0 }])
      down.clear()
    },
  }
}

export function bindInput(target: InputTarget): () => void {
  const { stage, sink } = target
  const pointer = pointerHandlers(target)
  const keys = keyHandlers(target)
  const release = () => {
    pointer.releaseAll()
    keys.releaseAll()
  }
  const hidden = () => {
    if (document.visibilityState === "hidden") release()
  }
  const quiet = (event: Event) => event.preventDefault()
  const stageEvents = {
    pointermove: pointer.move,
    pointerdown: pointer.down,
    pointerup: pointer.up,
    pointercancel: pointer.up,
    pointerleave: pointer.leave,
    contextmenu: quiet,
  } as const
  const sinkEvents = {
    keydown: keys.keydown,
    keyup: keys.keyup,
    compositionend: keys.compositionend,
    input: keys.input,
    paste: keys.paste,
    blur: release,
  } as const

  for (const [name, handler] of Object.entries(stageEvents)) stage.addEventListener(name, handler as EventListener)
  for (const [name, handler] of Object.entries(sinkEvents)) sink.addEventListener(name, handler as EventListener)
  stage.addEventListener("wheel", pointer.wheel, { passive: false })
  document.addEventListener("visibilitychange", hidden)

  return () => {
    release()
    for (const [name, handler] of Object.entries(stageEvents)) stage.removeEventListener(name, handler as EventListener)
    for (const [name, handler] of Object.entries(sinkEvents)) sink.removeEventListener(name, handler as EventListener)
    stage.removeEventListener("wheel", pointer.wheel)
    document.removeEventListener("visibilitychange", hidden)
  }
}
