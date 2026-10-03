import { useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { Bird } from "../mascot/bird"
import { ModelPickerButton } from "../settings/model-picker"
import { sectionOf } from "./sections"
import { TabStrip } from "./tab-strip"

/*
 * The 50 px bar over the main panel, laid out as kat's: the bird at the far
 * left, the chat tabs, and one quiet control on the right, the chat's model.
 * Other sections leave it empty: the sidebar already names them. The chat's name
 * and member count live in its tab and its info panel, not here a second time.
 */
export function TopBar() {
  const location = useLocation()
  const section = () => sectionOf(location.pathname)
  const chatId = () => {
    const id = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1]
    return id && id !== "new" ? decodeURIComponent(id) : null
  }
  return (
    <header
      class="flex h-[50px] shrink-0 items-center gap-2 px-3 text-sm font-medium text-muted"
      data-component="top-bar"
    >
      <Show when={section() === "chat"}>
        <Bird spec={{ species: "kiko", tint: 0, accessory: "none" }} size={24} class="mx-1" />
        <TabStrip />
        <ModelPickerButton chatId={chatId()} />
      </Show>
    </header>
  )
}
