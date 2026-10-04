import { splitProps, type ComponentProps } from "solid-js"
import { ICONS, type IconKey } from "../icons.gen"

export type { IconKey }

export type HugeIconProps = Omit<ComponentProps<"svg">, "children"> & {
  name: IconKey
  /** Pixels. Defaults to 16. */
  size?: number
  /** Defaults to 1.75, monocode's weight, a touch heavier than the source's 1.5. */
  strokeWidth?: number
}

/** One of kiko's icons. The glyphs are Hugeicons, copied into `icons.gen.ts` by `scripts/gen-icons.ts`. */
export function HugeIcon(props: HugeIconProps) {
  const [own, rest] = splitProps(props, ["name", "size", "strokeWidth"])
  return (
    <svg
      data-component="huge-icon"
      data-icon={own.name}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={own.size ?? 16}
      height={own.size ?? 16}
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={own.strokeWidth ?? 1.75}
      {...rest}
      innerHTML={ICONS[own.name]}
    />
  )
}
