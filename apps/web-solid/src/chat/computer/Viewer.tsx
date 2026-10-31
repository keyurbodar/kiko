import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, CloseIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { createEffect, For, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { agentDisplayName } from "../../lib/names"
import { user } from "../../state/user"
import { closeViewer, computerById, computers, openViewer, release, takeOver, viewerFor } from "../computers"
import { accessHint, canControl } from "./access"
import LiveScreen from "./LiveScreen"

const pill = "h-8 shrink-0 cursor-pointer rounded-full px-3.5 type-sm font-medium whitespace-nowrap"

export default function Viewer(): JSX.Element {
  const pc = () => computerById(viewerFor() ?? "")
  const interactive = () => {
    const computer = pc()
    return computer?.holder === "human" && canControl(computer)
  }
  const reason = () => pc()?.agent?.reason
  const agentName = () => {
    const slug = pc()?.agent?.slug
    return slug ? agentDisplayName(slug, user.agents()) : undefined
  }
  let panel: HTMLDivElement | undefined

  const leave = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.shiftKey !== interactive()) return
    event.preventDefault()
    closeViewer()
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
            class="flex h-full max-h-[min(860px,100%)] w-full max-w-[1280px] flex-col gap-2 rounded-3xl bg-[color-mix(in_oklab,var(--bg-chrome)_92%,var(--text-primary))] p-2 shadow-2xl outline-none"
          >
            <div
              class={cn(
                "flex min-h-11 shrink-0 items-center gap-3 rounded-xl py-1.5 pr-2 pl-4",
                interactive()
                  ? "bg-[color-mix(in_oklab,var(--text-warning)_16%,transparent)] text-warning"
                  : "bg-[color-mix(in_oklab,var(--text-primary)_6%,transparent)] text-primary",
              )}
              data-part="bar"
            >
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-base font-medium" data-field="viewer-reason">
                  {reason() ??
                    (interactive() ? `You are controlling ${computer().name}` : `Watching ${computer().name}`)}
                </span>
                <Show when={accessHint(computer())}>
                  {(line) => (
                    <span class="truncate type-xs opacity-70" data-field="viewer-access">
                      {line()}
                    </span>
                  )}
                </Show>
              </div>
              <Show when={interactive()}>
                <span
                  class="hidden shrink-0 type-xs font-normal whitespace-nowrap opacity-70 sm:inline"
                  data-field="escape-hint"
                >
                  Esc goes to the computer, Shift+Esc leaves
                </span>
              </Show>
              <Show when={computers().length > 1}>
                <MenuV2 gutter={6} placement="bottom-end">
                  <MenuV2.Trigger
                    class="flex h-8 max-w-44 min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--text-primary)_8%,transparent)] pr-2.5 pl-3.5 type-sm font-medium text-primary hover:bg-[color-mix(in_oklab,var(--text-primary)_12%,transparent)] aria-expanded:bg-[color-mix(in_oklab,var(--text-primary)_12%,transparent)]"
                    aria-label="Computer"
                    data-action="computer-switch"
                  >
                    <span class="truncate">{computer().name}</span>
                    <RemixIcon icon={ChevronDownIcon} size={12} class="shrink-0 opacity-70" />
                  </MenuV2.Trigger>
                  <MenuV2.Portal>
                    <MenuV2.Content class="min-w-44">
                      <MenuV2.RadioGroup value={computer().id} onChange={(id) => openViewer(id)}>
                        <For each={computers()}>
                          {(c) => (
                            <MenuV2.RadioItem value={c.id} closeOnSelect>
                              <span class="flex-1 truncate">{c.name}</span>
                              <Show when={!c.online}>
                                <span class="type-xs ml-3 text-quaternary">Offline</span>
                              </Show>
                            </MenuV2.RadioItem>
                          )}
                        </For>
                      </MenuV2.RadioGroup>
                    </MenuV2.Content>
                  </MenuV2.Portal>
                </MenuV2>
              </Show>
              <Show
                when={interactive()}
                fallback={
                  <Show
                    when={canControl(computer())}
                    fallback={
                      <span
                        class="shrink-0 px-2 type-sm whitespace-nowrap text-tertiary"
                        data-field="takeover-unavailable"
                      >
                        {computer().online ? "View only" : "Offline"}
                      </span>
                    }
                  >
                    <button
                      type="button"
                      class={cn(pill, "bg-neutral text-invert")}
                      data-action="computer-takeover"
                      onClick={() => void takeOver(computer().id)}
                    >
                      Take over
                    </button>
                  </Show>
                }
              >
                <button
                  type="button"
                  class={cn(pill, "bg-neutral text-invert")}
                  data-action="computer-release"
                  onClick={() => void release(computer().id)}
                >
                  I’m done, continue
                </button>
              </Show>
              <button
                type="button"
                class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-current opacity-70 hover:bg-[color-mix(in_oklab,var(--text-primary)_10%,transparent)] hover:opacity-100"
                aria-label="Hide the screen"
                title="Hide the screen"
                data-action="computer-hide"
                onClick={closeViewer}
              >
                <RemixIcon icon={CloseIcon} size={16} />
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
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
