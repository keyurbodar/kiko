import { splitProps, type ComponentProps } from "solid-js"
import { RemixIcon } from "./remix-icon"
import { ArrowUpIcon, type Glyph, LinkIcon, ReplyIcon, SearchIcon, StopIcon } from "../icons.gen"

const NAMES = {
  "arrow-up": ArrowUpIcon,
  stop: StopIcon,
  "arrow-undo-down": ReplyIcon,
  link: LinkIcon,
  "magnifying-glass": SearchIcon,
} as const satisfies Record<string, Glyph>

export type IconName = keyof typeof NAMES

export interface IconProps extends Omit<ComponentProps<"svg">, "children"> {
  name: IconName
  size?: "small" | "normal" | "medium" | "large"
}

export function Icon(props: IconProps) {
  const [local, others] = splitProps(props, ["name", "size"])
  return (
    <div data-component="icon" data-size={local.size || "normal"}>
      <RemixIcon {...others} data-slot="icon-svg" icon={NAMES[local.name]} />
    </div>
  )
}
