import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { SurfaceFailure, SurfaceLoading } from "../chrome"
import { sfntFamily } from "./font-family"

const MAX_BYTES = 10 * 1024 * 1024
const SIZES = [12, 16, 24, 40, 64]
const FAMILY = "KikoFilePreview"
const SENTENCE = "The quick brown fox jumps over the lazy dog."

export default function FontViewer(props: { name: string; src: string; size: number }): JSX.Element {
  const [family, setFamily] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const src = props.src
    const size = props.size
    setFamily(null)
    setError(null)
    if (size > MAX_BYTES) {
      setError("Font previews are limited to 10 MB.")
      return
    }
    let face: FontFace | undefined
    let cancelled = false
    void fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error("This font could not be loaded.")
        const bytes = new Uint8Array(await response.arrayBuffer())
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        face = new FontFace(FAMILY, buffer)
        await face.load()
        if (cancelled) return
        document.fonts.add(face)
        setFamily(sfntFamily(bytes) ?? props.name.replace(/\.[^.]+$/, ""))
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "This font could not be decoded.")
      })
    onCleanup(() => {
      cancelled = true
      if (face) document.fonts.delete(face)
    })
  })

  return (
    <Show when={!error()} fallback={<SurfaceFailure message={error() ?? ""} />}>
      <Show when={family()} fallback={<SurfaceLoading />}>
        {(name) => (
          <div class="min-h-0 flex-1 overflow-auto" data-component="file-font">
            <div class="mx-auto flex max-w-[860px] flex-col gap-6 px-6 py-6">
              <div class="flex items-baseline gap-3">
                <h2 class="text-section text-fg">{name()}</h2>
                <span class="text-hint text-fg3">{props.name}</span>
              </div>
              <p class="text-ui whitespace-pre-wrap break-words text-fg2" style={{ "font-family": FAMILY }}>
                ABCDEFGHIJKLMNOPQRSTUVWXYZ{"\n"}abcdefghijklmnopqrstuvwxyz{"\n"}0123456789 !?&@#%(){}[] — €£¥
              </p>
              <For each={SIZES}>
                {(size) => (
                  <div class="flex flex-col gap-1 border-t border-[var(--border-100)] pt-3">
                    <span class="text-hint text-fg3">{size} px</span>
                    <p
                      class="whitespace-pre-wrap break-words text-fg"
                      style={{ "font-family": FAMILY, "font-size": `${size}px`, "line-height": 1.35 }}
                    >
                      {SENTENCE}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </Show>
  )
}
