import { Show, splitProps, type Component, type JSX, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { deferred } from "./deferred"

type Impl = typeof import("./overlays-impl")

const overlays = deferred<Impl>(() => import("./overlays-impl"))

export const loadOverlaysV2 = overlays.load

export function part<C>(pick: (impl: Impl) => unknown, Closed: Component<never> = Nothing): C {
  const Fallback = Closed as Component<Record<string, unknown>>
  return ((props: Record<string, unknown>) => (
    <Show when={overlays.module()} fallback={<Fallback {...props} />}>
      {(impl) => <Dynamic component={pick(impl()) as Component<Record<string, unknown>>} {...props} />}
    </Show>
  )) as C
}

function Nothing(): JSX.Element {
  return null
}

export function Children(props: { children?: JSX.Element }): JSX.Element {
  return props.children
}

export function trigger(tag: ValidComponent): Component<{ as?: ValidComponent; [key: string]: unknown }> {
  return (props: { as?: ValidComponent; [key: string]: unknown }) => {
    const [local, rest] = splitProps(props, ["as"])
    const intent = () => void overlays.load()
    return <Dynamic component={local.as ?? tag} onPointerEnter={intent} onFocusIn={intent} {...rest} />
  }
}
