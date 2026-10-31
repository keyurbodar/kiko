import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { browser, closeBrowser, handBack, startBrowser } from "../chat/browser"
import { Button, Item } from "./kit"

function minutesOpen(since: number, now: number): string {
  const m = Math.max(0, Math.floor((now - since) / 60_000))
  return m < 1 ? "open for under a minute" : `open for ${m} ${m === 1 ? "minute" : "minutes"}`
}

export default function LiveBrowser(props: { icon: JSX.Element }) {
  onMount(startBrowser)
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(timer))
  return (
    <Show when={browser()}>
      {(b) => (
        <Item
          data-component="browser-live"
          icon={props.icon}
          title="Browser"
          meta={
            <span data-field="browser-meta">
              {b().switching ? "Opening browser" : b().mode === "headful" ? "Visible" : "Headless"},{" "}
              {minutesOpen(b().since, now())}
              {b().takeover ? ", you have control" : ""}
            </span>
          }
          actions={
            <>
              <Show when={b().takeover}>
                <Button data-action="browser-handback" onClick={handBack}>
                  Release control
                </Button>
              </Show>
              <Button variant="danger" data-action="browser-close" onClick={closeBrowser}>
                Close
              </Button>
            </>
          }
        >
          <Show when={b().tabs.length} fallback={<p class="text-sm text-secondary">No tabs open.</p>}>
            <ul class="flex flex-col gap-1 text-sm" data-field="browser-tabs">
              <For each={b().tabs}>
                {(tab) => (
                  <li class="flex gap-2">
                    <span class="font-medium">{tab.agent}</span>
                    <span class="text-secondary">{tab.host}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Item>
      )}
    </Show>
  )
}
