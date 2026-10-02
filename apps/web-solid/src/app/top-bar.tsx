import { useLocation } from "@solidjs/router"
import { Show } from "solid-js"
import { ModelPickerButton } from "../settings/model-picker"
import { sectionOf } from "./sections"
import { TabStrip } from "./tab-strip"

/*
 * The 50 px bar over the main panel. It names the section and nothing else:
 * kat's terminal, browser, notification and share controls are left out. The
 * chat route fills the same bar with its tab strip later.
 */
export function TopBar() {
  const location = useLocation()
  const section = () => sectionOf(location.pathname)
  const chatId = () => {
    const id = /^\/chat\/([^/]+)$/.exec(location.pathname)?.[1]
    return id && id !== "new" ? decodeURIComponent(id) : null
  }
  /* `/files/<room>/<path>` names the open file. Read from the URL, so this bar imports nothing from the files code. */
  const filePath = () => {
    const raw = /^\/files\/[^/]+\/(.+)$/.exec(location.pathname)?.[1]
    if (!raw) return null
    return raw.split("/").map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  }
  return (
    <header
      class="flex h-[50px] shrink-0 items-center gap-2 px-4 text-sm font-medium text-muted"
      data-component="top-bar"
    >
      <Show
        when={section() === "chat"}
        fallback={
          <Show when={section()}>
            {(id) => (
              <Show when={filePath()} fallback={<span data-component="top-bar-title">{id()}</span>}>
                {(parts) => (
                  <span class="truncate" data-component="top-bar-path" title={parts().join("/")}>
                    {/* The directory is muted and the file name is bold. */}
                    <Show when={parts().length > 1}>
                      <span class="text-weak">{parts().slice(0, -1).join("/")}/</span>
                    </Show>
                    <span class="font-bold text-text">{parts().at(-1)}</span>
                  </span>
                )}
              </Show>
            )}
          </Show>
        }
      >
        <TabStrip />
        <ModelPickerButton chatId={chatId()} />
      </Show>
    </header>
  )
}
