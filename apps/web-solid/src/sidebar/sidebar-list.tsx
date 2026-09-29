import { VList } from "virtua/solid"
import { Show, type JSX } from "solid-js"

export interface SidebarListItem<T> {
  key: string
  value: T
}

const Item = (props: {
  style: JSX.CSSProperties
  ref?: (element: Element) => void
  children: JSX.Element
}): JSX.Element => (
  <div ref={props.ref} style={props.style} data-slot="sidebar-virtual-item">
    {props.children}
  </div>
)

export function SidebarList<T>(props: {
  items: readonly SidebarListItem<T>[]
  entry: (item: SidebarListItem<T>) => JSX.Element
  label: string
  empty?: JSX.Element
}): JSX.Element {
  return (
    <nav data-slot="sidebar-list" aria-label={props.label}>
      <VList data={props.items} item={Item}>
        {(item) => props.entry(item)}
      </VList>
      <Show when={props.items.length === 0}>{props.empty}</Show>
    </nav>
  )
}
