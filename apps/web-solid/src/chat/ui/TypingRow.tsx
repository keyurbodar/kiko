import { animate } from "motion"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Signal } from "solid-js"
import { cn } from "../../lib/cn"

export interface TypingRowProps {
  /** Names currently typing. The row is not rendered when this is empty. */
  typists: readonly string[]
  /** True while the bubble holds after the last name left. */
  sending?: boolean
  /**
   * The shared wave, when a `createTypingPresence` store owns one. Left out, the
   * row keeps its own; either way exactly one animation drives the dots.
   */
  wave?: Signal<number>
  class?: string
}

const DOT_COUNT = 3
/** Seconds for one full pass of the wave across all three dots. */
const WAVE_PERIOD = 1.2

const SCALE_MIN = 0.74
const OPACITY_MIN = 0.32

/**
 * How far one dot is from the crest of the wave. The wave runs 0..3 and the
 * dots sit at 0, 1 and 2, so the phase wraps into -1.5..1.5 and the lift falls
 * off linearly to nothing half a cycle away.
 */
function dotLift(wave: number, index: number): number {
  const phase = (((wave - index) % DOT_COUNT) + DOT_COUNT) % DOT_COUNT
  const wrapped = phase > DOT_COUNT / 2 ? phase - DOT_COUNT : phase
  return Math.max(0, 1 - Math.abs(wrapped))
}

function announcement(typists: readonly string[], sending: boolean): string {
  if (typists.length === 0) return sending ? "sending" : ""
  if (typists.length === 1) return `${typists[0]} is typing`
  return `${typists.slice(0, -1).join(", ")} and ${typists.at(-1)} are typing`
}

function watchReducedMotion(set: (reduced: boolean) => void): void {
  if (typeof window === "undefined") return
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  const sync = (event: MediaQueryListEvent) => set(event.matches)
  set(query.matches)
  query.addEventListener("change", sync)
  onCleanup(() => query.removeEventListener("change", sync))
}

/**
 * The in-list typing row: an assistant-coloured bubble with three dots and no
 * text. The visible label is deliberately absent — the name goes to assistive
 * technology and nothing else, because a row of names under a conversation
 * nobody is looking at is just noise.
 */
export function TypingRow(props: TypingRowProps) {
  const ownedWave: Signal<number> = createSignal(0)
  const [reduced, setReduced] = createSignal(false)
  watchReducedMotion(setReduced)

  // One source of truth for the phase, whoever owns it: the dots read it and
  // the single animation writes it. The handle is stable for the row's life, so
  // it is read once.
  const [phase, advance] = props.wave ?? ownedWave

  const sending = () => props.sending ?? false
  const active = createMemo(() => props.typists.length > 0 || sending())
  const label = createMemo(() => announcement(props.typists, sending()))

  createEffect(() => {
    if (!active()) return
    if (reduced()) {
      // Park the wave at the crest and leave it there.
      advance(0)
      return
    }
    const controls = animate(0, DOT_COUNT, {
      duration: WAVE_PERIOD,
      ease: "linear",
      repeat: Number.POSITIVE_INFINITY,
      onUpdate: (value: number) => advance(value),
    })
    onCleanup(() => controls.stop())
  })

  return (
    <Show when={active()}>
      <li
        class={cn("flex items-start py-0.5", props.class)}
        data-component="chat-typing-row"
        role="listitem"
      >
        <div
          class={cn(
            "flex items-center gap-[3px] rounded-[calc(18px*var(--brm))] bg-message-assistant px-3 py-[7px]",
            // One text line plus the bubble's own padding, so the typing
            // bubble is exactly as tall as a one-line message bubble.
            "min-h-[calc(2*7px+var(--font-base)*var(--line-height))]",
          )}
          data-component="chat-typing-bubble"
          data-sending={sending() ? "" : undefined}
        >
          <For each={[...Array(DOT_COUNT).keys()]}>
            {(index) => {
              const lift = () => dotLift(phase(), index)
              return (
                <span
                  class="block size-1.5 origin-center rounded-full bg-text"
                  data-component="chat-typing-dot"
                  style={{
                    // Scale and opacity are written inline by the wave and
                    // there is no transition, so a dot is exactly where the
                    // animation says it is.
                    transform: `scale(${SCALE_MIN + (1 - SCALE_MIN) * lift()})`,
                    opacity: String(OPACITY_MIN + (1 - OPACITY_MIN) * lift()),
                  }}
                />
              )
            }}
          </For>
        </div>
        <span class="sr-only" role="status" aria-live="polite">
          {label()}
        </span>
      </li>
    </Show>
  )
}
