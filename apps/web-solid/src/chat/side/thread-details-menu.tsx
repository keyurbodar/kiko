import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { For } from "solid-js"
import { THREAD_DETAILS_ITEMS } from "./thread-details-items"
import {
  resetThreadDetails,
  setThreadDetailsVisible,
  threadDetailsDefault,
  threadDetailsVisibility,
} from "./thread-details-state"

export function ThreadDetailsMenuItems() {
  const visibility = () => threadDetailsVisibility()
  return (
    <>
      <MenuV2.Group>
        <MenuV2.GroupLabel>Show in thread details</MenuV2.GroupLabel>
        <For each={THREAD_DETAILS_ITEMS}>
          {(item) => (
            <MenuV2.CheckboxItem
              checked={visibility()[item.id]}
              onChange={(checked: boolean) => setThreadDetailsVisible(item.id, checked)}
            >
              {item.label}
            </MenuV2.CheckboxItem>
          )}
        </For>
      </MenuV2.Group>
      <MenuV2.Separator />
      <MenuV2.Item disabled={threadDetailsDefault()} onSelect={resetThreadDetails}>
        Reset to default
      </MenuV2.Item>
    </>
  )
}
