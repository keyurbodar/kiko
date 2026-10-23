import { Dialog } from "@kobalte/core/dialog"
import { splitProps, type ComponentProps } from "solid-js"
import "./modal-v2.css"

export interface ModalV2Props extends ComponentProps<typeof Dialog> {}

function ModalV2Root(props: ModalV2Props) {
  const [local, others] = splitProps(props, ["modal"])
  return <Dialog {...others} modal={local.modal ?? true} />
}

export interface ModalV2OverlayProps extends ComponentProps<typeof Dialog.Overlay> {}

function ModalV2Overlay(props: ModalV2OverlayProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Dialog.Overlay
      {...r}
      data-component="modal-v2-overlay"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export interface ModalV2ContentProps extends ComponentProps<typeof Dialog.Content> {}

function ModalV2Content(props: ModalV2ContentProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Dialog.Content
      {...r}
      data-component="modal-v2-content"
      aria-modal="true"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export interface ModalV2TitleProps extends ComponentProps<typeof Dialog.Title> {}

function ModalV2Title(props: ModalV2TitleProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Dialog.Title {...r} data-component="modal-v2-title" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }} />
  )
}

export interface ModalV2CloseProps extends ComponentProps<typeof Dialog.CloseButton> {}

function ModalV2Close(props: ModalV2CloseProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Dialog.CloseButton
      {...r}
      data-component="modal-v2-close"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export const ModalV2 = Object.assign(ModalV2Root, {
  Trigger: Dialog.Trigger,
  Portal: Dialog.Portal,
  Overlay: ModalV2Overlay,
  Content: ModalV2Content,
  Title: ModalV2Title,
  Close: ModalV2Close,
})
