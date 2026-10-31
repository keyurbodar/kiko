import type { ComputerInput } from "@kiko/protocol"
import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { takePending } from "../computers"
import { startBrowser, type BrowserSession, type BrowserStatus } from "./browserSession"
import { createInputGate } from "./control"
import { Cursor } from "./Cursor"
import { bindInput, type Point } from "./input"

const DEFAULT_RATIO = 16 / 10
const MAX_DPR = 2

export default function BrowserView(props: {
  pcId: string
  tab: string
  interactive: boolean
  label?: string
  class?: string
}): JSX.Element {
  const [status, setStatus] = createSignal<BrowserStatus>("connecting")
  const [message, setMessage] = createSignal<string | undefined>(undefined)
  const [viewport, setViewport] = createSignal<{ w: number; h: number } | null>(null)
  const [epoch, setEpoch] = createSignal(0)
  let canvas!: HTMLCanvasElement
  let stage!: HTMLDivElement
  let sink!: HTMLTextAreaElement
  let host!: HTMLDivElement
  let you: HTMLDivElement | undefined
  let session: BrowserSession | undefined
  const gate = createInputGate<ComputerInput>((events) => session?.send(events))

  const ratio = () => {
    const known = viewport()
    return known && known.h > 0 ? known.w / known.h : DEFAULT_RATIO
  }
  const place = (point: Point | null) => {
    if (!you) return
    you.style.display = point ? "" : "none"
    if (!point) return
    you.style.left = `${point.x * 100}%`
    you.style.top = `${point.y * 100}%`
  }

  onMount(() => {
    let last = ""
    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect()
      const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`
      if (size === last) return
      const first = last === ""
      last = size
      if (!first) setEpoch((n) => n + 1)
    })
    observer.observe(host)
    onCleanup(() => observer.disconnect())
  })

  createEffect(
    on([() => props.pcId, () => props.tab, epoch], ([pcId, tab]) => {
      const rect = host.getBoundingClientRect()
      const scale = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1))
      const size = {
        maxWidth: Math.round((rect.width || 1024) * scale),
        maxHeight: Math.round((rect.height || 640) * scale),
      }
      const next = startBrowser(pcId ?? "", tab ?? "", size, {
        canvas,
        onSize: (width, height) => setViewport({ w: width, h: height }),
        onStatus: (state, detail) => {
          setStatus(state)
          setMessage(detail)
        },
      })
      session = next
      onCleanup(() => {
        next.close()
        if (session === next) session = undefined
        setStatus("connecting")
      })
    }),
  )

  createEffect(() => {
    if (!props.interactive) return
    const unbind = bindInput({ stage, sink, send: (events) => gate.send(events), onPointer: place })
    sink.focus({ preventScroll: true })
    onCleanup(() => {
      unbind()
      gate.discard()
    })
  })

  createEffect(() => {
    if (!props.interactive) {
      gate.discard()
      return
    }
    if (takePending(props.pcId)) gate.hold()
    else gate.release()
  })

  const notice = () => {
    if (status() === "error") return message() ?? "The browser tab stopped"
    if (status() === "ended") return "The browser tab stopped sharing"
    if (status() === "connecting") return "Connecting to the browser tab"
    return undefined
  }

  return (
    <div
      ref={host}
      class={cn("relative overflow-hidden", props.class)}
      style={{ width: "100%", height: "100%", "container-type": "size" }}
      data-component="computer-browser"
      data-status={status()}
      data-interactive={props.interactive ? "" : undefined}
    >
      <div class="absolute inset-0 grid place-items-center">
        <div
          ref={stage}
          class={cn("relative touch-none bg-white select-none", props.interactive && "cursor-none")}
          style={{ width: `min(100cqw, calc(100cqh * ${ratio()}))`, "aspect-ratio": String(ratio()) }}
          data-part="stage"
        >
          <canvas ref={canvas} class="absolute inset-0 size-full" />
          <Show when={props.interactive}>
            <Cursor ref={(el) => (you = el)} tone="you" label="You" style={{ display: "none" }} />
            <textarea
              ref={sink}
              class="pointer-events-none absolute top-0 left-0 size-px resize-none opacity-0"
              aria-label="Keyboard input for the browser tab"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              data-part="sink"
            />
          </Show>
        </div>
      </div>
      <Show when={notice()}>
        {(line) => (
          <div
            class="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-4 py-2 text-center text-sm text-white/70"
            role="status"
            data-part="browser-notice"
          >
            {line()}
          </div>
        )}
      </Show>
    </div>
  )
}
