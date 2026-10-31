import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { setTerminalSize, terminalKey } from "@kiko/client-runtime/state"
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { startTerminal, type TerminalStatus } from "./terminalSession"

const FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
const FONT_SIZE = 13
const LINE_HEIGHT = 1.2
const PADDING = 12
const MIN_COLS = 20
const MIN_ROWS = 5

const THEME = {
  background: "#0a0a0b",
  foreground: "#e7e7ea",
  cursor: "#f5f5f7",
  selectionBackground: "#3b3b44",
}

function measureCell(): { width: number; height: number } {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return { width: FONT_SIZE * 0.6, height: FONT_SIZE * LINE_HEIGHT }
  context.font = `${FONT_SIZE}px ${FONT_FAMILY}`
  const metrics = context.measureText("W")
  const ascent = metrics.fontBoundingBoxAscent || FONT_SIZE * 0.8
  const descent = metrics.fontBoundingBoxDescent || FONT_SIZE * 0.2
  return { width: metrics.width, height: (ascent + descent) * LINE_HEIGHT }
}

export default function TerminalView(props: {
  pcId: string
  terminalId: string
  interactive: boolean
  class?: string
}): JSX.Element {
  const [status, setStatus] = createSignal<TerminalStatus>("connecting")
  const [message, setMessage] = createSignal<string | undefined>(undefined)
  let host!: HTMLDivElement
  let term: Terminal | undefined
  let resize: ResizeObserver | undefined
  const key = terminalKey(props.pcId, props.terminalId)

  const fit = () => {
    if (!term || !host) return
    const { width, height } = host.getBoundingClientRect()
    const cell = measureCell()
    const cols = Math.max(MIN_COLS, Math.floor((width - PADDING * 2) / cell.width))
    const rows = Math.max(MIN_ROWS, Math.floor((height - PADDING * 2) / cell.height))
    setTerminalSize(key, cols, rows)
    if (cols === term.cols && rows === term.rows) return
    term.resize(cols, rows)
  }

  onMount(() => {
    const created = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      letterSpacing: 0,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: 5_000,
      theme: THEME,
    })
    term = created
    created.open(host)
    fit()
    const current = startTerminal(props.pcId, props.terminalId, {
      onEvent(event) {
        if (event.type === "snapshot") created.write(event.history)
        else if (event.type === "output") created.write(event.data)
      },
      onStatus(next, detail) {
        setStatus(next)
        setMessage(detail)
      },
    })
    created.onData((data) => {
      if (props.interactive) current.input(data)
    })
    created.onResize(({ cols, rows }) => current.resize(cols, rows))
    resize = new ResizeObserver(() => fit())
    resize.observe(host)
    onCleanup(() => {
      resize?.disconnect()
      current.close()
      created.dispose()
      term = undefined
    })
  })

  createEffect(() => {
    if (!term) return
    term.options.disableStdin = !props.interactive
    if (props.interactive) term.focus()
  })

  const notice = () => {
    if (status() === "error") return message() ?? "The terminal stopped"
    if (status() === "ended") return "The terminal exited"
    if (status() === "connecting") return "Connecting to the terminal"
    return undefined
  }

  return (
    <div
      class={cn("relative size-full overflow-hidden bg-[#0a0a0b]", props.class)}
      data-component="computer-terminal"
      data-status={status()}
      data-interactive={props.interactive ? "" : undefined}
    >
      <div ref={host} class="size-full px-3 py-3" data-part="terminal" />
      <Show when={notice()}>
        {(line) => (
          <div
            class="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-4 py-2 text-center text-sm text-white/70"
            role="status"
            data-part="terminal-notice"
          >
            {line()}
          </div>
        )}
      </Show>
    </div>
  )
}
