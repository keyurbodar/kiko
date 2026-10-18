import { splitProps, type ComponentProps } from "solid-js"
import type { Glyph } from "../icons.gen"

export type { Glyph }

export type RemixIconProps = Omit<ComponentProps<"svg">, "children"> & {
  /** A glyph from `@kiko/ui/icons`, such as `SearchIcon`. */
  icon: Glyph
  /** Pixels. Defaults to 16. */
  size?: number
}

/** One of kiko's icons. The glyphs are Remix Icon, copied into `icons.gen.ts` by `scripts/gen-icons.ts`. */
export function RemixIcon(props: RemixIconProps) {
  const [own, rest] = splitProps(props, ["icon", "size"])
  return (
    <svg
      data-component="remix-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={own.size ?? 16}
      height={own.size ?? 16}
      fill="currentColor"
      {...rest}
      innerHTML={own.icon}
    />
  )
}
