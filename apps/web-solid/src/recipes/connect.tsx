import { For, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { Button, buttonClass } from "../settings/kit"
import { RecipeIcon } from "./icon"
import { connectAsk, dismissConnect, isWaiting, retryConnect } from "./state"

export function ConnectSheet() {
  return (
    <Show when={connectAsk()}>
      {(ask) => (
        <Dialog
          open
          onClose={dismissConnect}
          data-component="recipe-connect"
          title={
            <span class="flex items-center gap-3.5 pt-1">
              <RecipeIcon recipe={ask().card} size={44} />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-[17px] font-semibold tracking-[-0.01em]">Connect apps first</span>
                <span class="truncate text-[12.5px] font-normal text-muted-foreground">
                  {ask().card.title} needs them
                </span>
              </span>
            </span>
          }
          footer={
            <>
              <Button variant="ghost" class="rounded-full" onClick={dismissConnect}>
                Cancel
              </Button>
              <Button
                variant="primary"
                class="rounded-full px-4"
                data-action="connect-done"
                busy={isWaiting(ask().card.slug)}
                onClick={retryConnect}
              >
                Done, add it
              </Button>
            </>
          }
        >
          <div class="flex flex-col gap-2">
            <Show
              when={ask().connect.links.length}
              fallback={
                <p class="text-[14px] leading-relaxed text-foreground/85" data-component="recipe-connect-reason">
                  {ask().connect.reason}
                </p>
              }
            >
              <p class="text-[14px] leading-relaxed text-foreground/85">
                Open each link, allow access, then come back here. The recipe is added once they are connected.
              </p>
              <For each={ask().connect.links}>
                {(link) => (
                  <a
                    class={buttonClass("secondary", "justify-center rounded-full")}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-action="connect-app"
                    data-app={link.app}
                  >
                    Connect {link.app}
                  </a>
                )}
              </For>
            </Show>
          </div>
        </Dialog>
      )}
    </Show>
  )
}
