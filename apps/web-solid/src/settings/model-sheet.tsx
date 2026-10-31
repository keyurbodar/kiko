import { defaultThinking, type ThinkingLevel } from "@kiko/protocol"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { canReason } from "./agent-model"
import { modelRef } from "./model-list"
import { ModelList } from "./model-picker-panel"
import { ReasoningChoices } from "./reasoning-menu"

const DISMISS_PX = 80

export function ModelSheet(props: {
  current?: string
  levels: readonly ThinkingLevel[] | undefined
  value: ThinkingLevel | undefined
  onPick: (ref: string, thinking: readonly ThinkingLevel[], name: string) => void
  onThinking: (level: ThinkingLevel) => void
  onClose: () => void
}) {
  const [drag, setDrag] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)
  let startY = 0
  const levels = () => props.levels ?? []
  const value = () => props.value ?? defaultThinking(levels())
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      props.onClose()
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })
  const end = () => {
    if (!dragging()) return
    setDragging(false)
    if (drag() > DISMISS_PX) props.onClose()
    else setDrag(0)
  }
  return (
    <Portal>
      <div class="model-sheet-layer" data-kb-top-layer="" data-component="model-sheet">
        <div class="model-sheet-backdrop" aria-hidden="true" onClick={() => props.onClose()} />
        <div
          class="model-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Model and thinking"
          data-dragging={dragging() ? "" : undefined}
          style={drag() ? { transform: `translateY(${drag()}px)` } : undefined}
        >
          <div
            class="model-sheet-grip"
            data-action="drag-model-sheet"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              startY = event.clientY
              setDragging(true)
            }}
            onPointerMove={(event) => dragging() && setDrag(Math.max(0, event.clientY - startY))}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span class="model-sheet-handle" />
          </div>
          <div class="model-sheet-head">
            <h2 class="type-base text-primary">Model</h2>
            <button
              type="button"
              class="model-sheet-done"
              data-action="close-model-sheet"
              onClick={() => props.onClose()}
            >
              Done
            </button>
          </div>
          <div class="model-sheet-list">
            <ModelList
              current={props.current}
              autofocus={false}
              onClose={() => props.onClose()}
              onPick={(row) => {
                const ref = modelRef(row.provider.id, row.model.id)
                if (ref !== props.current) props.onPick(ref, row.model.thinking, row.model.name)
              }}
            />
          </div>
          <Show when={canReason(props.levels)}>
            <section class="model-sheet-thinking" aria-label="Reasoning" data-component="model-sheet-thinking">
              <h3 class="model-sheet-thinking-title">Reasoning</h3>
              <ReasoningChoices levels={levels()} value={value()} onChange={props.onThinking} />
            </section>
          </Show>
        </div>
      </div>
    </Portal>
  )
}
