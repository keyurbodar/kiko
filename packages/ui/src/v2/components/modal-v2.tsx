import { Dialog } from "@kobalte/core/dialog"
import { splitProps, type ComponentProps } from "solid-js"
import "./modal-v2.css"

/**
 * A modal SHELL: Kobalte's Dialog with the stacking, the centring and the
 * scrim filled in, and nothing else.
 *
 * `DialogV2` is the sized panel — `dialog-v2.css` hardcodes a 480x368 surface
 * because a settings dialog has one obvious size. A lightbox, a media viewer
 * and a confirmation do not, and a shell that picks for them picks wrong every
 * time and has to be fought with overrides. So this one is chromeless: no
 * width, no height, no max-width, no padding. The caller owns the box.
 *
 * Everything a modal must do that a `div` cannot is Kobalte's, and is not
 * reimplemented here: the focus trap, escape-to-close, `role="dialog"`, the
 * focus restore, the scroll lock, the `aria-hidden` on everything outside, and
 * the outside-pointer-events suppression.
 */

export interface ModalV2Props extends ComponentProps<typeof Dialog> {}

function ModalV2Root(props: ModalV2Props) {
  const [local, others] = splitProps(props, ["modal"])
  // Modal by default: the whole reason to reach for a Dialog over a plain
  // overlay is that the rest of the app stops being reachable.
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
      // Kobalte locks focus, hides the rest of the tree from assistive tech
      // and suppresses outside pointer events, but it does NOT emit
      // `aria-modal`. `role="dialog"` without it does not tell a screen reader
      // that what follows is background; this does.
      aria-modal="true"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export interface ModalV2TitleProps extends ComponentProps<typeof Dialog.Title> {}

function ModalV2Title(props: ModalV2TitleProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Dialog.Title
      {...r}
      data-component="modal-v2-title"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
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
