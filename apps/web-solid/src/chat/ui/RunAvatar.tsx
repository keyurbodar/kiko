import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"

/** The avatar beside a group run, in pixels. */
export const RUN_AVATAR_PX = 32

/**
 * How far a track reaches up when the run's first row is not mounted. That row is above the
 * viewport, so a track that reaches past it changes nothing a reader can see.
 */
const FAR = 100_000

/**
 * The mounted tracks of each run, by run key. A row that comes or goes re-measures only its own
 * run's tracks: a shared counter made every avatar in the transcript query the DOM on every mount.
 */
const runs = new Map<string, Set<() => void>>()

function rowsChanged(runKey: string) {
  for (const schedule of runs.get(runKey) ?? []) schedule()
}

/**
 * The avatar of an agent's run of bubbles in a group.
 *
 * The face sits beside the last bubble, bottom-aligned, and while the run is taller
 * than the viewport the face sticks to the bottom edge and rides up with the last bubble. The
 * transcript is virtual, so the run is not one element to stick inside, and its last row may
 * not be mounted yet. So every row of the run carries a track, and only the run's last mounted
 * row shows it. The track reaches up to the run's first row and, unless that row is the run's
 * real end, down past the viewport; the face is `position: sticky` at the track's bottom, so it
 * travels the whole run and no further. Tracks are measured on mount, on scroll, and whenever a
 * run row comes or goes.
 */
export function RunAvatar(props: { seed: string; runKey: string; isRunEnd: boolean }): JSX.Element {
  let track!: HTMLDivElement
  const [shape, setShape] = createSignal<{ above: number; below: number } | null>(null)

  const measure = () => {
    const row = track.parentElement
    const scroller = row?.closest<HTMLElement>("[data-virtual-scroll]")
    if (!row || !scroller) return
    const rows = scroller.querySelectorAll<HTMLElement>(`[data-run-key="${CSS.escape(props.runKey)}"]`)
    if (rows[rows.length - 1] !== row) return setShape(null)
    const first = rows[0]!
    const above = first.hasAttribute("data-run-first") ? Math.max(0, row.getBoundingClientRect().top - first.getBoundingClientRect().top) : FAR
    // A run whose end is not mounted continues below the viewport: reach just past its bottom
    // edge, and no further, so the track never makes the transcript taller.
    const below = props.isRunEnd ? 0 : Math.max(0, Math.ceil(scroller.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom)) + RUN_AVATAR_PX
    const now = shape()
    if (!now || now.above !== above || now.below !== below) setShape({ above, below })
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
    const scroller = track.closest<HTMLElement>("[data-virtual-scroll]")
    scroller?.addEventListener("scroll", schedule, { passive: true })
    createEffect(on(() => props.isRunEnd, schedule))
    // A row whose run changes (its run grew a new first row) moves to the new run's set.
    createEffect(
      on(
        () => props.runKey,
        (key) => {
          let mine = runs.get(key)
          if (!mine) runs.set(key, (mine = new Set()))
          mine.add(schedule)
          rowsChanged(key)
          onCleanup(() => {
            mine.delete(schedule)
            if (mine.size === 0) runs.delete(key)
            else rowsChanged(key)
          })
        },
      ),
    )
    onCleanup(() => {
      cancelAnimationFrame(frame)
      scroller?.removeEventListener("scroll", schedule)
    })
  })

  return (
    <div
      ref={track}
      class="pointer-events-none absolute left-4 flex flex-col justify-end"
      style={{
        top: `-${shape()?.above ?? 0}px`,
        bottom: shape()?.below ? `-${shape()!.below}px` : "var(--row-gap)",
        width: `${RUN_AVATAR_PX}px`,
        visibility: shape() ? undefined : "hidden",
      }}
      data-component="chat-run-avatar"
      data-shown={shape() ? "" : undefined}
      aria-hidden="true"
    >
      <Show when={shape()}>
        <IdentityAvatar seed={props.seed} size={RUN_AVATAR_PX} class="sticky bottom-2" />
      </Show>
    </div>
  )
}
