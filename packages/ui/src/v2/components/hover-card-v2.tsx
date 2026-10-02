import type { HoverCardV2 as Impl } from "./hover-card-v2-impl"
import { Children, part, trigger } from "./overlays"

export type { HoverCardV2ContentProps, HoverCardV2Props } from "./hover-card-v2-impl"

/* The real hover card lives in hover-card-v2-impl.tsx and loads after first paint. See overlays.tsx. */
type H = typeof Impl

export const HoverCardV2 = Object.assign(part<H>((i) => i.HoverCardV2, Children), {
  Trigger: part<H["Trigger"]>((i) => i.HoverCardV2.Trigger, trigger("a")),
  Content: part<H["Content"]>((i) => i.HoverCardV2.Content),
  Arrow: part<H["Arrow"]>((i) => i.HoverCardV2.Arrow),
  Portal: part<H["Portal"]>((i) => i.HoverCardV2.Portal),
})
