import { Tabs } from "@kobalte/core/tabs"
import { createSignal, onMount, splitProps, type ComponentProps } from "solid-js"

export { Tabs as TabsV2 }

export function TabsPill(props: ComponentProps<typeof Tabs.Indicator>) {
  const [local, rest] = splitProps(props, ["class"])
  const [settled, setSettled] = createSignal(false)
  onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true))))
  return (
    <Tabs.Indicator
      {...rest}
      class={local.class ? `pill-indicator ${local.class}` : "pill-indicator"}
      data-settled={settled() ? "" : undefined}
    />
  )
}
