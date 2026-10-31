import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, CloseIcon, PlusIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import type { TerminalSummary } from "@kiko/protocol"
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { agentDisplayName } from "../../lib/names"
import { user } from "../../state/user"
import { closeViewer, computerById, computers, openViewer, release, takeOver, viewerFor } from "../computers"
import { accessHint, canControl } from "./access"
import LiveScreen from "./LiveScreen"
import TerminalView from "./TerminalView"
import { listTerminals, openTerminal } from "./terminals"

const pill =
  "type-base h-control-xl shrink-0 cursor-pointer rounded-base px-3 font-medium whitespace-nowrap transition-[background-color,scale] duration-(--duration-fast) hover:bg-(--bg-neutral-hover) active:scale-(--press-scale)"

const tab =
  "h-control-md cursor-pointer rounded-base px-2.5 type-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast)"

export default function Viewer(): JSX.Element {
  const [terminals, setTerminals] = createSignal<readonly TerminalSummary[]>([])
  const [active, setActive] = createSignal("desktop")
  const [opening, setOpening] = createSignal(false)
  const pc = () => computerById(viewerFor() ?? "")
  const canTake = () => {
    const computer = pc()
    if (!computer?.online) return false
    return active() === "desktop" ? canControl(computer) : computer.caps.terminal === true
  }
  const control = (): "watching" | "you" | "other" => {
    const computer = pc()
    if (computer?.holder !== "human") return "watching"
    return computer.heldBy === "you" ? "you" : "other"
  }
  const interactive = () => canTake() && control() === "you"
  const stateLabel = () => {
    const name = pc()?.name ?? ""
    if (control() === "you") return `You have control of ${name}`
    if (control() === "other") return `Another viewer has control of ${name}`
    return `Watching ${name}`
  }
  const reason = () => pc()?.agent?.reason
  const agentName = () => {
    const slug = pc()?.agent?.slug
    return slug ? agentDisplayName(slug, user.agents()) : undefined
  }
  let panel: HTMLDivElement | undefined

  const refresh = async (pcId: string) => {
    const open = await listTerminals(pcId)
    if (viewerFor() !== pcId) return
    setTerminals(open)
    if (active() !== "desktop" && !open.some((terminal) => terminal.id === active())) setActive("desktop")
  }

  const addTerminal = async () => {
    const pcId = viewerFor()
    if (!pcId || opening()) return
    setOpening(true)
    const opened = await openTerminal(pcId, 100, 30)
    setOpening(false)
    if (!opened) return
    setTerminals((all) => [...all.filter((terminal) => terminal.id !== opened.id), opened])
    setActive(opened.id)
  }

  createEffect(
    on(viewerFor, (pcId) => {
      setActive("desktop")
      setTerminals([])
      if (pcId) void refresh(pcId)
    }),
  )
  createEffect(
    on(
      () => pc()?.busy,
      (busy, before) => {
        if (before === true && busy !== true && viewerFor()) void refresh(viewerFor() ?? "")
      },
      { defer: true },
    ),
  )

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
                <span class="truncate text-base font-semibold" data-field="viewer-reason" data-state={control()}>
                  {reason() ?? stateLabel()}
                </span>
                <Show when={reason()}>
                  <span class="truncate type-xs opacity-70" data-field="viewer-state">
                    {stateLabel()}
                  </span>
                </Show>
                <Show when={control() === "other"}>
                  <span class="truncate type-xs opacity-70" data-field="viewer-held-elsewhere">
                    Take over to move it to this tab.
                  </span>
                </Show>
                <Show when={active() === "desktop" ? accessHint(computer()) : null}>
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
                    class="type-base flex h-control-xl max-w-44 min-w-0 cursor-pointer items-center gap-1.5 rounded-base bg-tertiary pr-2 pl-3 text-primary transition-colors duration-(--duration-fast) hover:bg-secondary aria-expanded:bg-secondary"
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
                    when={canTake()}
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
                class="grid size-control-xl shrink-0 cursor-pointer place-items-center rounded-base icon-secondary transition-colors duration-(--duration-fast) hover:bg-quaternary hover:icon-primary"
                aria-label="Hide the screen"
                title="Hide the screen"
                data-action="computer-hide"
                onClick={closeViewer}
              >
                <RemixIcon icon={CloseIcon} size={14} />
              </button>
            </div>
            <Show when={terminals().length > 0 || computer().caps.terminal}>
              <div class="flex shrink-0 items-center gap-1 overflow-x-auto px-1" data-part="terminal-tabs">
                <button
                  type="button"
                  class={cn(
                    tab,
                    active() === "desktop"
                      ? "bg-tertiary text-primary"
                      : "text-secondary hover:bg-quaternary hover:text-primary",
                  )}
                  data-action="computer-tab-desktop"
                  onClick={() => setActive("desktop")}
                >
                  Desktop
                </button>
                <For each={terminals()}>
                  {(terminal) => (
                    <button
                      type="button"
                      class={cn(
                        tab,
                        "max-w-56 truncate",
                        active() === terminal.id
                          ? "bg-tertiary text-primary"
                          : "text-secondary hover:bg-quaternary hover:text-primary",
                      )}
                      data-action="computer-tab-terminal"
                      data-terminal-id={terminal.id}
                      onClick={() => setActive(terminal.id)}
                    >
                      {terminal.name}
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  class="grid size-control-md shrink-0 cursor-pointer place-items-center rounded-base text-secondary transition-colors duration-(--duration-fast) hover:bg-quaternary hover:text-primary disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
                  aria-label="New terminal"
                  title="New terminal"
                  data-action="computer-tab-new-terminal"
                  disabled={opening() || !computer().online}
                  onClick={() => void addTerminal()}
                >
                  <RemixIcon icon={PlusIcon} size={12} />
                </button>
              </div>
            </Show>
            <div class="min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
              <Show when={computer().id} keyed>
                {(id) => (
                  <Show
                    when={active() === "desktop" ? undefined : active()}
                    keyed
                    fallback={
                      <LiveScreen
                        pcId={id}
                        interactive={interactive()}
                        agentName={agentName() ?? ""}
                        class="size-full"
                      />
                    }
                  >
                    {(terminalId) => (
                      <TerminalView pcId={id} terminalId={terminalId} interactive={interactive()} class="size-full" />
                    )}
                  </Show>
                )}
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
