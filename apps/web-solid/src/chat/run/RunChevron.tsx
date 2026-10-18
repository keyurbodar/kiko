import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { createEffect, onCleanup } from "solid-js"
import { cn } from "../../lib/cn"
import { useApp } from "../../lib/store"
import { openRun, preloadRunPanel, registerRunAnchor, toggleRun } from "./run-panel-state"

/** The chevron's box, which the hover actions step past. */
export const CHEVRON_SIZE = 32

/**
 * Opens the run panel for a run. Always visible and muted, beside the run's first bubble or its
 * typing row. A click is the only way the panel opens. State changes at once, with no motion.
 */
export function RunChevron(props: { windowKey: string; class?: string }) {
  let button: HTMLButtonElement | undefined
  createEffect(() => {
    const element = button
    if (element) onCleanup(registerRunAnchor(props.windowKey, element))
  })
  const open = () => openRun() === props.windowKey
  return (
    <button
      ref={button}
      type="button"
      class={cn(
        "grid shrink-0 cursor-default place-items-center rounded-full p-0 text-muted-foreground/70",
        "hover:bg-[var(--accent-strong)] hover:text-foreground focus-visible:bg-[var(--accent-strong)] focus-visible:text-foreground",
        "data-[open]:bg-[var(--accent-strong)] data-[open]:text-foreground",
        props.class,
      )}
      style={{ width: `${CHEVRON_SIZE}px`, height: `${CHEVRON_SIZE}px` }}
      aria-label="Show steps"
      aria-haspopup="dialog"
      aria-expanded={open()}
      data-component="run-chevron"
      data-open={open() ? "" : undefined}
      onPointerEnter={preloadRunPanel}
      onFocus={preloadRunPanel}
      onClick={() => {
        toggleRun(props.windowKey)
        useApp.loadRunSteps(props.windowKey)
      }}
    >
      <RemixIcon icon={ChevronRightIcon} size={16} />
    </button>
  )
}
