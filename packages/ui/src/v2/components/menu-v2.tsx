import type { MenuV2 as Impl } from "./menu-v2-impl"
import { part } from "./overlays"

export type {
  MenuV2CheckboxItemProps,
  MenuV2ItemProps,
  MenuV2RadioItemProps,
  MenuV2SubTriggerProps,
} from "./menu-v2-impl"

type M = typeof Impl
type C = M["Context"]

const MenuV2Context = Object.assign(
  part<C>((i) => i.MenuV2.Context),
  {
    Trigger: part<C["Trigger"]>((i) => i.MenuV2.Context.Trigger),
    Portal: part<C["Portal"]>((i) => i.MenuV2.Context.Portal),
    Content: part<C["Content"]>((i) => i.MenuV2.Context.Content),
  },
)

export const MenuV2 = Object.assign(
  part<M>((i) => i.MenuV2),
  {
    Trigger: part<M["Trigger"]>((i) => i.MenuV2.Trigger),
    Portal: part<M["Portal"]>((i) => i.MenuV2.Portal),
    Content: part<M["Content"]>((i) => i.MenuV2.Content),
    Item: part<M["Item"]>((i) => i.MenuV2.Item),
    CheckboxItem: part<M["CheckboxItem"]>((i) => i.MenuV2.CheckboxItem),
    RadioGroup: part<M["RadioGroup"]>((i) => i.MenuV2.RadioGroup),
    RadioItem: part<M["RadioItem"]>((i) => i.MenuV2.RadioItem),
    Group: part<M["Group"]>((i) => i.MenuV2.Group),
    GroupLabel: part<M["GroupLabel"]>((i) => i.MenuV2.GroupLabel),
    Separator: part<M["Separator"]>((i) => i.MenuV2.Separator),
    Sub: part<M["Sub"]>((i) => i.MenuV2.Sub),
    SubTrigger: part<M["SubTrigger"]>((i) => i.MenuV2.SubTrigger),
    SubContent: part<M["SubContent"]>((i) => i.MenuV2.SubContent),
    Context: MenuV2Context,
  },
)
