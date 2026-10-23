import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"

export const RUN_AVATAR_PX = 32

const FAR = 100_000

const runs = new Map<string, Set<() => void>>()

function rowsChanged(runKey: string) {
  for (const schedule of runs.get(runKey) ?? []) schedule()
}

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
    const above = first.hasAttribute("data-run-first")
      ? Math.max(0, row.getBoundingClientRect().top - first.getBoundingClientRect().top)
      : FAR
    const below = props.isRunEnd
      ? 0
      : Math.max(0, Math.ceil(scroller.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom)) +
        RUN_AVATAR_PX
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
