import { splitProps, type ComponentProps } from "solid-js"
import { HugeIcon, type IconKey } from "../../components/huge-icon"

/* The v2 set's names, each drawn by one of kiko's icons. */
const NAMES = {
  plus: "plus",
  "chevron-down": "chevron-down",
  "outline-chevron-down": "chevron-down",
  "xmark-small": "close",
  "outline-xmark": "close",
  close: "close",
  check: "check",
  edit: "edit",
  folder: "folder",
  "magnifying-glass": "search",
  menu: "menu",
  "settings-gear": "settings",
  "sidebar-right": "sidebar-right",
  "outline-dots": "more",
  "outline-copy": "copy",
  "outline-share": "share",
  reset: "undo",
  "outline-reset": "undo",
  expand: "maximize",
  filetree: "folder-tree",
  archive: "archive",
  monitor: "monitor",
} as const satisfies Record<string, IconKey>

export type IconName = keyof typeof NAMES

export interface IconProps extends Omit<ComponentProps<"svg">, "children"> {
  name: IconName
  size?: "small" | "normal" | "large"
}

export function Icon(props: IconProps) {
  const [split, rest] = splitProps(props, ["name", "size"])
  const px = () => (split.size === "small" ? 14 : split.size === "large" ? 20 : 16)
  return <HugeIcon {...rest} data-slot="icon-svg" name={NAMES[split.name]} size={px()} />
}
