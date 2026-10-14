import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { Show, createUniqueId, type JSX } from "solid-js"
import { iconButtonClass } from "../settings/kit"
import { cn } from "./cn"

const WIDTH = {
  sm: "w-[min(420px,calc(100vw-32px))]",
  md: "w-[min(560px,calc(100vw-32px))]",
} as const

export function Dialog(props: {
  open: boolean
  onClose: () => void
  title: JSX.Element
  description?: JSX.Element
  size?: keyof typeof WIDTH
  footer?: JSX.Element
  onSubmit?: (event: SubmitEvent) => void
  class?: string
  bodyClass?: string
  "data-component"?: string
  children?: JSX.Element
}): JSX.Element {
  const describedBy = createUniqueId()
  const inner = () => (
    <>
      <div class={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5 empty:hidden", props.bodyClass)}>{props.children}</div>
      <Show when={props.footer}>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 pb-5">{props.footer}</div>
      </Show>
    </>
  )
  return (
    <ModalV2 open={props.open} onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay class="animate-none" />
        <ModalV2.Content
          class={cn("max-h-[calc(100dvh-32px)] animate-none flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-popover", WIDTH[props.size ?? "sm"], props.class)}
          aria-describedby={props.description ? describedBy : undefined}
        >

          <div class="relative flex min-h-0 flex-1 flex-col" data-component={props["data-component"]}>
            <header class="shrink-0 px-5 pt-4 pr-12 pb-4">
              <ModalV2.Title class="text-base font-semibold leading-snug text-foreground">{props.title}</ModalV2.Title>
              <Show when={props.description}>
                <p id={describedBy} class="mt-1 text-[13px] leading-relaxed text-[var(--kit-meta)]">
                  {props.description}
                </p>
              </Show>
            </header>
            <Show when={props.onSubmit} fallback={inner()}>
              <form class="flex min-h-0 flex-1 flex-col" onSubmit={(e) => props.onSubmit!(e)}>
                {inner()}
              </form>
            </Show>

            <button type="button" aria-label="Close" title="Close" class={cn(iconButtonClass, "absolute top-3 right-3")} data-action="close-dialog" onClick={() => props.onClose()}>
              <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
