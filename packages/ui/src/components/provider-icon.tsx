import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { spriteSubset } from "./sprite-subset"
import { iconNames, type IconName } from "./provider-icons/types"

/** Only the icons in use are copied into the page. See `sprite-subset.ts`. */
const providerIcon = spriteSubset(sprite, "provider-icon-")

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const resolved = createMemo(() => (iconNames.includes(local.id as IconName) ? local.id : "synthetic"))
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={providerIcon(resolved())} />
    </svg>
  )
}
