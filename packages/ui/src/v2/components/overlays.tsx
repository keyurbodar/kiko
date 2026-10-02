import { Show, splitProps, type Component, type JSX, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { deferred } from "./deferred"

/*
 * Menus, tooltips, hover cards and dialogs are Kobalte plus floating-ui, about 30 KB gzip, and
 * none of them is open on first paint. They load in one chunk after first paint: main.tsx calls
 * `loadOverlaysV2()` on idle, and a closed trigger loads it on first pointer or focus intent.
 *
 * Until the chunk lands, each part renders what it renders while closed: a root renders its
 * children, a trigger renders its element, and a portal or content renders nothing. When it
 * lands, every part switches to Kobalte once.
 */
type Impl = typeof import("./overlays-impl")

const overlays = deferred<Impl>(() => import("./overlays-impl"))

export const loadOverlaysV2 = overlays.load

/* A part that renders the Kobalte component once loaded, and `Closed` before. */
export function part<C>(pick: (impl: Impl) => unknown, Closed: Component<any> = Nothing): C {
  return ((props: Record<string, unknown>) => (
    <Show when={overlays.module()} fallback={<Closed {...props} />}>
      {(impl) => <Dynamic component={pick(impl()) as Component<any>} {...props} />}
    </Show>
  )) as C
}

function Nothing(): JSX.Element {
  return null
}

/* A closed root: just its children. */
export function Children(props: { children?: JSX.Element }): JSX.Element {
  return props.children
}

/* A closed trigger: its element, with the tag Kobalte would use by default. */
export function trigger(tag: ValidComponent): Component<any> {
  return (props: { as?: ValidComponent }) => {
    const [local, rest] = splitProps(props, ["as"])
    const intent = () => void overlays.load()
    return <Dynamic component={local.as ?? tag} onPointerEnter={intent} onFocusIn={intent} {...rest} />
  }
}
