import { createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"

/** The avatar beside a group run, in pixels. Telegram's is 34 to 40; kat's bubbles are smaller. */
export const RUN_AVATAR_PX = 32

/**
 * How far above the last row a track may reach when the run's first row is not rendered. The
 * virtualizer drops rows that are well above the viewport, and then the run's top is above the
 * viewport too, so a track that reaches past it changes nothing a reader can see.
 */
const FAR = 100_000

/**
 * The avatar of an agent's run of bubbles in a group, drawn in the run's last row.
 *
 * Telegram puts the face beside the last bubble, bottom-aligned, and while the run is taller
 * than the viewport the face sticks to the bottom edge and rides up with the last bubble. The
 * transcript is virtual, so the run is not one element to stick inside. Instead the last row
 * holds a track that reaches up to the top of the run's first row, and the face is
 * `position: sticky` at the bottom of that track: it can travel the whole run and no further.
 * The track's height is measured on mount and on scroll, which is when rows come and go.
 */
export function RunAvatar(props: { seed: string; runKey: string }): JSX.Element {
  let track!: HTMLDivElement
  const [above, setAbove] = createSignal(0)

  const measure = () => {
    const row = track.parentElement
    const scroller = row?.closest<HTMLElement>("[data-virtual-scroll]")
    if (!row || !scroller) return
    const first = scroller.querySelector<HTMLElement>(`[data-run-first][data-run-key="${CSS.escape(props.runKey)}"]`)
    const next = first ? Math.max(0, row.getBoundingClientRect().top - first.getBoundingClientRect().top) : FAR
    if (next !== above()) setAbove(next)
  }

  onMount(() => {
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    schedule()
    const scroller = track.closest<HTMLElement>("[data-virtual-scroll]")
    scroller?.addEventListener("scroll", schedule, { passive: true })
    onCleanup(() => {
      cancelAnimationFrame(frame)
      scroller?.removeEventListener("scroll", schedule)
    })
  })

  return (
    <div
      ref={track}
      class="pointer-events-none absolute bottom-(--row-gap) left-4 flex flex-col justify-end"
      style={{ top: `-${above()}px`, width: `${RUN_AVATAR_PX}px` }}
      data-component="chat-run-avatar"
      aria-hidden="true"
    >
      <IdentityAvatar seed={props.seed} size={RUN_AVATAR_PX} class="sticky bottom-2" />
    </div>
  )
}
