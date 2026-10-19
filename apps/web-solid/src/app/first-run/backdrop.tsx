import { onCleanup, onMount } from "solid-js"
import { mountGlacier } from "./glacier"

export function Backdrop() {
  let canvas: HTMLCanvasElement | undefined
  onMount(() => {
    if (canvas) onCleanup(mountGlacier(canvas))
  })
  return (
    <div class="welcome-backdrop" aria-hidden="true">
      <canvas ref={canvas} class="welcome-glacier" />
    </div>
  )
}
