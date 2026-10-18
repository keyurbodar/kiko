import { RemixIcon } from "@kiko/ui/remix-icon"
import { GlobeIcon } from "@kiko/ui/icons"
import { Show, onMount, type JSX } from "solid-js"
import type { ChatMessage } from "../lib/types"
import { browser, startBrowser } from "./browser"
import { BrowserButtons } from "./BrowserChip"

/**
 * An agent asks for the human in the browser: a login, a captcha, a payment. The newest request carries the same
 * buttons as the browser bar, so taking control and releasing it happen here, and the card holds no link.
 */
export default function BrowserControlRow(props: { message: ChatMessage; latest: boolean }): JSX.Element {
  onMount(startBrowser)
  const status = () => (browser()?.takeover ? "You have control. Agents are paused." : props.latest ? "Agents have control." : "")
  return (
    <div class="mx-auto flex w-full max-w-(--chat-content-max-width) justify-center px-4 py-2" data-component="browser-control" data-message-id={props.message.id}>
      <div class="flex max-w-full flex-col items-start gap-2 rounded-xl bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] px-3 py-2 text-sm text-foreground">
        <div class="flex min-w-0 items-start gap-2">
          <RemixIcon icon={GlobeIcon} class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span>{props.message.body}</span>
            <Show when={props.latest && status()}>
              <span class="text-xs text-muted-foreground" data-field="browser-control-status">
                {status()}
              </span>
            </Show>
          </div>
        </div>
        <Show when={props.latest}>
          <div class="ps-6">
            <BrowserButtons />
          </div>
        </Show>
      </div>
    </div>
  )
}
