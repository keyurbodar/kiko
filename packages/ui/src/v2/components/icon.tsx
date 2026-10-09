import { splitProps, type ComponentProps } from "solid-js"
import { HugeIcon } from "../../components/huge-icon"
import * as g from "../../icons.gen"

/* The v2 set's names, each drawn by one of yuki's icons. */
const NAMES = {
  plus: g.PlusIcon,
  "chevron-down": g.ChevronDownIcon,
  "outline-chevron-down": g.ChevronDownIcon,
  "xmark-small": g.CloseIcon,
  "outline-xmark": g.CloseIcon,
  close: g.CloseIcon,
  check: g.CheckIcon,
  edit: g.EditIcon,
  folder: g.FolderIcon,
  "magnifying-glass": g.SearchIcon,
  menu: g.MenuIcon,
  "settings-gear": g.SettingsIcon,
  "sidebar-right": g.SidebarRightIcon,
  "outline-dots": g.MoreIcon,
  "outline-copy": g.CopyIcon,
  "outline-share": g.ShareIcon,
  reset: g.UndoIcon,
  "outline-reset": g.UndoIcon,
  expand: g.MaximizeIcon,
  filetree: g.FolderTreeIcon,
  archive: g.ArchiveIcon,
  monitor: g.MonitorIcon,
} as const satisfies Record<string, g.Glyph>

export type IconName = keyof typeof NAMES

export interface IconProps extends Omit<ComponentProps<"svg">, "children"> {
  name: IconName
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])
  const px = () => (split.size === "small" ? 14 : split.size === "large" ? 20 : 16)
  return <HugeIcon {...rest} data-slot="icon-svg" icon={NAMES[split.name]} size={px()} />
}
