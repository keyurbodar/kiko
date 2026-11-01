import type { ComputerInput } from "@kiko/protocol"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { connection } from "../../state/connection"
import { computerById, takePending } from "../computers"
import { accessHint } from "./access"
import { createInputGate } from "./control"
import { Cursor } from "./Cursor"
import { bindInput, escapeEvents } from "./input"
import { offlineNotice } from "./offline"
import { type Cursor as AgentPoint, type Mode, type Session, startSession } from "./session"

const DEFAULT_RATIO = 16 / 10
const AGENT_IDLE_MS = 1_500

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
  const [picked, setPicked] = createSignal<string | null>(null)
  const [waiting, setWaiting] = createSignal<string | null>(null)
  let copied: string | null = null
  let agentTimer: ReturnType<typeof setTimeout> | undefined
  const streams = createMemo(() => {
    const computer = computerById(props.pcId)
    return computer?.online === true && computer.caps.live
  })
  const displays = () => computerById(props.pcId)?.displays ?? []
  const chosen = () => {
    const all = displays()
    return all.find((display) => display.id === picked()) ?? all[0]
  }
  const display = () => {
    const current = chosen()
    return current ? { width: current.width, height: current.height, scale: current.scale } : null
  }
  const ratio = () => {
    const known = size()
    if (known) return known.w / known.h
    const current = chosen()
    return current?.height ? current.width / current.height : DEFAULT_RATIO
  }
  const remoteMods = () => (computerById(props.pcId)?.os === "macos" ? 8 : 2)
  let video!: HTMLVideoElement
  let canvas!: HTMLCanvasElement
  let stage!: HTMLDivElement
  let sink!: HTMLTextAreaElement
  let session: Session | undefined
  const gate = createInputGate<ComputerInput>((events) => session?.send(events))

  const showAgent = (point: AgentPoint) => {
    setAgent(point)
    clearTimeout(agentTimer)
    if (point) agentTimer = setTimeout(() => setAgent(null), AGENT_IDLE_MS)
  }

  const writeClipboard = async (text: string) => {
    if (!navigator.clipboard?.writeText) {
      setWaiting(text)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      copied = text
      setWaiting(null)
    } catch {
      setWaiting(text)
    }
  }

  const offer = (text: string) => {
    if (!props.interactive || !text || copied === text) return
    void writeClipboard(text)
  }

  const pick = (id: string) => {
    setPicked(id)
    session?.pick(id)
    if (props.interactive) sink.focus({ preventScroll: true })
  }

  createEffect(
    on(
      connection.connected,
      (up) => {
        if (up) setEpoch((n) => n + 1)
      },
      { defer: true },
    ),
  )

  createEffect(
    on([streams, epoch, () => props.pcId], ([live]) => {
      if (!live) return
      const next = startSession(props.pcId, {
        video,
        canvas,
        display: untrack(display),
        onMode: setMode,
        onSize: (w, h) => setSize((prev) => (prev?.w === w && prev.h === h ? prev : { w, h })),
        onCursor: showAgent,
        onClipboard: offer,
      })
      session = next
      const id = untrack(picked)
      if (id) next.pick(id)
      onCleanup(() => {
        next.close()
        if (session === next) session = undefined
        setMode("connecting")
      })
    }),
  )

  createEffect(() => {
    if (!props.interactive) return
    const unbind = bindInput({
      stage,
      sink,
      pasteMods: remoteMods,
      send: (events) => gate.send(events),
    })
    sink.focus({ preventScroll: true })
    onCleanup(() => {
      unbind()
      gate.discard()
    })
  })

  createEffect(() => {
    if (!props.interactive) {
      setWaiting(null)
      gate.discard()
      return
    }
    if (takePending(props.pcId)) gate.hold()
    else gate.release()
  })

  createEffect(() => {
    if (!props.interactive) return
    const gesture = () => {
      const text = waiting()
      if (text) void writeClipboard(text)
    }
    stage.addEventListener("pointerdown", gesture)
    stage.addEventListener("keydown", gesture)
    onCleanup(() => {
      stage.removeEventListener("pointerdown", gesture)
      stage.removeEventListener("keydown", gesture)
    })
  })

  onCleanup(() => clearTimeout(agentTimer))

  createEffect(() => {
    if (!props.interactive) return
    const remote = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.shiftKey || event.defaultPrevented) return
      if (event.target === sink) return
      event.preventDefault()
      gate.send(escapeEvents(event))
      sink.focus({ preventScroll: true })
    }
    document.addEventListener("keydown", remote)
    onCleanup(() => {
      document.removeEventListener("keydown", remote)
    })
  })

  const offline = () => {
    const computer = computerById(props.pcId)
    return computer && !computer.online ? offlineNotice(computer, Date.now()) : null
  }
  const notice = () => {
    const computer = computerById(props.pcId)
    if (!computer) return "This computer is offline"
    const hint = accessHint(computer)
    if (hint) return hint
    if (!computer.caps.live) return "The live view is off on this computer"
    return mode() === "stalled"
      ? "The screen is not sharing. Check that ffmpeg is installed on that computer."
      : "Connecting to the screen"
  }
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
          <canvas
            ref={canvas}
            class={cn("absolute inset-0 size-full", mode() === "rtc" ? "opacity-0" : "opacity-100")}
          />
          <Show when={agent()}>
            {(point) => (
              <Cursor
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
      <Show when={displays().length > 1}>
        <div class="absolute top-2 right-2 z-10 rounded-base bg-black/60 px-2 py-1">
          <select
            aria-label="Display"
            data-part="display-picker"
            class="cursor-pointer bg-transparent type-xs text-white/85 outline-none"
            value={chosen()?.id ?? ""}
            onChange={(event) => pick(event.currentTarget.value)}
          >
            <For each={displays()}>
              {(entry, index) => (
                <option value={entry.id} class="text-black">
                  {`Display ${index() + 1} · ${entry.width}×${entry.height}`}
                </option>
              )}
            </For>
          </select>
        </div>
      </Show>
      <Show when={mode() === "connecting" || mode() === "stalled"}>
        <div
          class="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/70"
          role="status"
          data-part="connecting"
        >
          <Show when={offline()} fallback={notice()}>
            {(notice) => (
              <div class="flex flex-col gap-1" data-part="offline">
                <span class="text-base font-medium text-white/90" data-field="offline-title">
                  {notice().title}
                </span>
                <span data-field="offline-detail">{notice().detail}</span>
                <span data-field="offline-fix">{notice().fix}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
