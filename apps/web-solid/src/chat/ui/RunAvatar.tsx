import { createEffect, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { registerRunAvatar, runRowsChanged, RUN_AVATAR_PX, type AvatarShape } from "./run-avatar-registry"

export function RunAvatar(props: { seed: string; runKey: string; isRunEnd: boolean }): JSX.Element {
  let track!: HTMLDivElement
  const [shape, setShape] = createSignal<AvatarShape | null>(null)

  const apply = (next: AvatarShape | null) => {
    const now = shape()
    if (now === next) return
    if (now && next && now.above === next.above && now.below === next.below) return
    setShape(next)
  }

  onMount(() => {
    const dispose = registerRunAvatar(track, {
      track: () => track,
      runKey: () => props.runKey,
      isRunEnd: () => props.isRunEnd,
      apply,
    })
    createEffect(
      on(
        () => props.isRunEnd,
        () => runRowsChanged(props.runKey),
      ),
    )
    createEffect(
      on(
        () => props.runKey,
        (key, previous) => {
          if (previous !== undefined) runRowsChanged(previous)
          runRowsChanged(key)
        },
        { defer: true },
      ),
    )
    onCleanup(dispose)
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
