import type { Component, JSX } from "solid-js"
import { createMemo, Match, splitProps, Switch } from "solid-js"
import { KeyIcon } from "../icons.gen"
import sprite from "./provider-icons/sprite.svg"
import { spriteSubset } from "./sprite-subset"
import { iconNames, type IconName } from "./provider-icons/types"

const providerIcon = spriteSubset(sprite, "provider-icon-")

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

const GOOGLE: JSX.Element = (
  <>
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.64v3.02h3.86c2.26-2.08 3.56-5.14 3.56-8.9Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.12A11.99 11.99 0 0 0 12 24Z"
    />
    <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.58V6.57H1.29a12 12 0 0 0 0 10.82l3.98-3.12Z" />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.57l3.98 3.12C6.22 6.86 8.87 4.75 12 4.75Z"
    />
  </>
)

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const google = createMemo(() => local.id === "google")
  const typesafe = createMemo(() => local.id === "typesafe")
  const resolved = createMemo(() => (iconNames.includes(local.id as IconName) ? local.id : "synthetic"))
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      viewBox={google() ? "0 0 24 24" : typesafe() ? "0 0 300 300" : undefined}
      fill="currentColor"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Switch fallback={<use href={providerIcon(resolved())} />}>
        <Match when={google()}>{GOOGLE}</Match>
        <Match when={typesafe()}>
          <g innerHTML={KeyIcon} />
        </Match>
      </Switch>
    </svg>
  )
}
