import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { Show, createRenderEffect, createUniqueId, on, type JSX } from "solid-js"
import { iconButtonClass } from "../settings/kit"
import { cn } from "./cn"

function returnFocus(opener: Element | null, closing: EventTarget | null): void {
  if (opener instanceof HTMLElement && opener.isConnected) return opener.focus({ preventScroll: true })
  const below = [...document.querySelectorAll<HTMLElement>('[data-component="modal-v2-content"]')].filter(
    (el) => el !== closing,
  )
  below.at(-1)?.focus({ preventScroll: true })
}

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
  let opener: Element | null = null
  createRenderEffect(
    on(
      () => props.open,
      (open) => {
        if (open) opener = document.activeElement
      },
    ),
  )
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
        <ModalV2.Overlay />
        <ModalV2.Content
          class={cn(
            "max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-3xl bg-elevated text-primary shadow-[var(--popup-shadow)]",
            WIDTH[props.size ?? "sm"],
            props.class,
          )}
          aria-describedby={props.description ? describedBy : undefined}
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault()
            returnFocus(opener, event.currentTarget)
          }}
        >
          <div class="relative flex min-h-0 flex-1 flex-col" data-component={props["data-component"]}>
            <header class="shrink-0 px-5 pt-4 pr-12 pb-4">
              <ModalV2.Title class="type-3xl font-semibold leading-snug text-primary">{props.title}</ModalV2.Title>
              <Show when={props.description}>
                <p id={describedBy} class="mt-1 text-sm leading-relaxed text-[var(--kit-meta)]">
                  {props.description}
                </p>
              </Show>
            </header>
            <Show when={props.onSubmit} fallback={inner()}>
              <form class="flex min-h-0 flex-1 flex-col" onSubmit={(e) => props.onSubmit!(e)}>
                {inner()}
              </form>
            </Show>

            <button
              type="button"
              aria-label="Close"
              title="Close"
              class={cn(iconButtonClass, "absolute top-3 right-3")}
              data-action="close-dialog"
              onClick={() => props.onClose()}
            >
              <svg
                class="size-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
