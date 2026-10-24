import type { ModalV2 as Impl } from "./modal-v2-impl"
import { part } from "./overlays"

export type {
  ModalV2CloseProps,
  ModalV2ContentProps,
  ModalV2OverlayProps,
  ModalV2Props,
  ModalV2TitleProps,
} from "./modal-v2-impl"

type D = typeof Impl

export const ModalV2 = Object.assign(
  part<D>((i) => i.ModalV2),
  {
    Trigger: part<D["Trigger"]>((i) => i.ModalV2.Trigger),
    Portal: part<D["Portal"]>((i) => i.ModalV2.Portal),
    Overlay: part<D["Overlay"]>((i) => i.ModalV2.Overlay),
    Content: part<D["Content"]>((i) => i.ModalV2.Content),
    Title: part<D["Title"]>((i) => i.ModalV2.Title),
    Close: part<D["Close"]>((i) => i.ModalV2.Close),
  },
)
