import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { connection } from "../../state/connection"
import { computerById } from "../computers"
import { Cursor } from "./Cursor"
import { bindInput, escapeEvents, type Point } from "./input"
import { type Cursor as AgentPoint, type Mode, type Session, startSession } from "./session"

const DEFAULT_RATIO = 16 / 10

const sameCursor = (a: AgentPoint, b: AgentPoint) => a?.x === b?.x && a?.y === b?.y

export default function LiveScreen(props: {
  pcId: string
  interactive: boolean
  agentName?: string
  class?: string
}): JSX.Element {
  const [mode, setMode] = createSignal<Mode>("connecting")
  const [size, setSize] = createSignal<{ w: number; h: number } | null>(null)
  const [agent, setAgent] = createSignal<AgentPoint>(null, { equals: sameCursor })
  const [epoch, setEpoch] = createSignal(0)
  const online = () => computerById(props.pcId)?.online === true
  const ratio = () => {
    const known = size()
    if (known) return known.w / known.h
    const display = computerById(props.pcId)?.displays[0]
    return display?.height ? display.width / display.height : DEFAULT_RATIO
  }
  let video!: HTMLVideoElement
  let canvas!: HTMLCanvasElement
  let stage!: HTMLDivElement
  let sink!: HTMLTextAreaElement
  let you: HTMLDivElement | undefined
  let session: Session | undefined

  createEffect(
    on(
      connection.connected,
      (up) => {
        if (up) setEpoch((n) => n + 1)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    epoch()
    if (!online()) return
    const next = startSession(props.pcId, {
      video,
      canvas,
      onMode: setMode,
      onSize: (w, h) => setSize((prev) => (prev?.w === w && prev.h === h ? prev : { w, h })),
      onCursor: setAgent,
    })
    session = next
    onCleanup(() => {
      next.close()
      if (session === next) session = undefined
      setMode("connecting")
    })
  })

  const place = (point: Point | null) => {
    if (!you) return
    you.style.display = point ? "" : "none"
    if (!point) return
    you.style.left = `${point.x * 100}%`
    you.style.top = `${point.y * 100}%`
  }

  createEffect(() => {
    if (!props.interactive) return
    const unbind = bindInput({ stage, sink, send: (events) => session?.send(events), onPointer: place })
    sink.focus({ preventScroll: true })
    onCleanup(unbind)
  })

  createEffect(() => {
    if (!props.interactive) return
    const remote = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.shiftKey || event.defaultPrevented) return
      if (event.target === sink) return
      event.preventDefault()
      session?.send(escapeEvents(event))
      sink.focus({ preventScroll: true })
    }
    document.addEventListener("keydown", remote)
    onCleanup(() => {
      document.removeEventListener("keydown", remote)
    })
  })

  const showing = (which: Mode) => (mode() === which ? "opacity-100" : "opacity-0")

  return (
    <div
      class={cn("relative size-full overflow-hidden", props.class)}
      style={{ "container-type": "size" }}
      data-component="computer-screen"
      data-mode={mode()}
      data-interactive={props.interactive ? "" : undefined}
    >
      <div class="absolute inset-0 grid place-items-center">
        <div
          ref={stage}
          class={cn("relative touch-none bg-black/60 select-none", props.interactive && "cursor-none")}
          style={{ width: `min(100cqw, calc(100cqh * ${ratio()}))`, "aspect-ratio": String(ratio()) }}
          data-part="stage"
        >
          <video
            ref={video}
            class={cn("absolute inset-0 size-full object-fill", showing("rtc"))}
            playsinline
            muted
            autoplay
            disablepictureinpicture
            disableremoteplayback
          />
          <canvas ref={canvas} class={cn("absolute inset-0 size-full", showing("relay"))} />
          <Show when={!props.interactive ? agent() : null}>
            {(point) => (
              <Cursor
                tone="agent"
                label={props.agentName}
                style={{
                  left: `${point().x * 100}%`,
                  top: `${point().y * 100}%`,
                  transition: "left 90ms linear, top 90ms linear",
                }}
              />
            )}
          </Show>
          <Show when={props.interactive}>
            <Cursor ref={(el) => (you = el)} tone="you" label="You" style={{ display: "none" }} />
            <textarea
              ref={sink}
              class="pointer-events-none absolute top-0 left-0 size-px resize-none opacity-0"
              aria-label="Keyboard input for the computer"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              data-part="sink"
            />
          </Show>
        </div>
      </div>
      <Show when={mode() === "connecting"}>
        <div
          class="absolute inset-0 grid place-items-center text-label text-white/70"
          role="status"
          data-part="connecting"
        >
          {online() ? "Connecting to the screen" : "This computer is offline"}
        </div>
      </Show>
    </div>
  )
}
