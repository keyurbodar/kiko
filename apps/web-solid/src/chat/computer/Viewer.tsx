import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon } from "@kiko/ui/icons"
import { createEffect, For, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { agentDisplayName } from "../../lib/names"
import { useApp } from "../../lib/store"
import { closeViewer, computerById, computers, openViewer, release, takeOver, viewerFor } from "../computers"
import LiveScreen from "./LiveScreen"

const pill =
  "h-8 shrink-0 cursor-pointer rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"

export default function Viewer(): JSX.Element {
  const pc = () => computerById(viewerFor() ?? "")
  const interactive = () => pc()?.holder === "human" && pc()?.caps.input === true && pc()?.online === true
  const reason = () => pc()?.agent?.reason
  const agentName = () => {
    const slug = pc()?.agent?.slug
    return slug ? agentDisplayName(slug, useApp.agents()) : undefined
  }
  let panel: HTMLDivElement | undefined

  const leave = (event: KeyboardEvent) => {
    const typing = event.target instanceof HTMLElement && event.target.dataset.part === "sink"
    if (event.key === "Escape" && !typing && !event.defaultPrevented) closeViewer()
  }
  createEffect(() => {
    if (!pc()) closeViewer()
  })
  createEffect(() => {
    if (!interactive()) panel?.focus({ preventScroll: true })
  })
  document.addEventListener("keydown", leave)
  onCleanup(() => document.removeEventListener("keydown", leave))

  return (
    <Show when={pc()}>
      {(computer) => (
        <div
          class="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 backdrop-blur-[2px] sm:p-6"
          data-component="computer-viewer"
          onPointerDown={(event) => event.target === event.currentTarget && closeViewer()}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={`${computer().name} screen`}
            tabindex="-1"
            class="flex h-full max-h-[min(860px,100%)] w-full max-w-[1280px] flex-col gap-2 rounded-[22px] bg-[color-mix(in_oklab,var(--background)_92%,var(--foreground))] p-2 shadow-2xl outline-none"
          >
            <div
              class={cn(
                "flex min-h-11 shrink-0 items-center gap-3 rounded-[14px] py-1.5 pr-2 pl-4",
                interactive()
                  ? "bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-warning"
                  : "bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-foreground",
              )}
              data-part="bar"
            >
              <span class="min-w-0 flex-1 truncate text-md font-medium" data-field="viewer-reason">
                {reason() ?? (interactive() ? `You are controlling ${computer().name}` : `Watching ${computer().name}`)}
              </span>
              <Show when={computers().length > 1}>
                <select
                  class="h-8 max-w-40 rounded-full bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-3 text-[13px] text-foreground outline-none"
                  aria-label="Computer"
                  value={computer().id}
                  onChange={(event) => openViewer(event.currentTarget.value)}
                >
                  <For each={computers()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
                </select>
              </Show>
              <Show
                when={interactive()}
                fallback={
                  <button
                    type="button"
                    class={cn(pill, "bg-foreground text-background")}
                    data-action="computer-takeover"
                    disabled={!computer().online || !computer().caps.input}
                    onClick={() => takeOver(computer().id)}
                  >
                    Take over
                  </button>
                }
              >
                <button
                  type="button"
                  class={cn(pill, "bg-foreground text-background")}
                  data-action="computer-release"
                  onClick={() => release(computer().id)}
                >
                  I’m done, continue
                </button>
              </Show>
              <button
                type="button"
                class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-current opacity-70 hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:opacity-100"
                aria-label="Hide the screen"
                title="Hide the screen"
                data-action="computer-hide"
                onClick={closeViewer}
              >
                <RemixIcon icon={CloseIcon} size={16} />
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-hidden rounded-[14px] bg-black">
              <Show when={computer().id} keyed>
                {(id) => (
                  <LiveScreen pcId={id} interactive={interactive()} agentName={agentName() ?? ""} class="size-full" />
                )}
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
