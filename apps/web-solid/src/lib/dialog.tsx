import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon } from "@kiko/ui/icons"
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
      <div class={cn("min-h-0 flex-1 overflow-y-auto px-6 pb-6 empty:hidden", props.bodyClass)}>{props.children}</div>
      <Show when={props.footer}>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pb-6">{props.footer}</div>
      </Show>
    </>
  )
  return (
    <ModalV2 open={props.open} onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class={cn("max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-3xl bg-surface text-foreground shadow-popover", WIDTH[props.size ?? "sm"], props.class)}
          aria-describedby={props.description ? describedBy : undefined}
        >

          <div class="relative flex min-h-0 flex-1 flex-col" data-component={props["data-component"]}>
            <header class="shrink-0 px-6 pt-5 pr-14 pb-4">
              <ModalV2.Title class="font-display text-[20px] font-bold leading-snug tracking-[-0.015em] text-foreground">{props.title}</ModalV2.Title>
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

            <button type="button" aria-label="Close" title="Close" class={cn(iconButtonClass, "absolute top-4 right-4")} data-action="close-dialog" onClick={() => props.onClose()}>
              <RemixIcon icon={CloseIcon} class="size-3.5" />
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
