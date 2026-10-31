import { Show, createMemo, onMount, type JSX } from "solid-js"
import { room } from "../state/room"
import { browser, handBack, openLive, startBrowser } from "./browser"

const button =
  "inline-flex h-control-md shrink-0 items-center rounded-base bg-tertiary px-2 type-base text-primary transition-[background-color,transform] hover:bg-secondary active:scale-(--press-scale) disabled:opacity-(--opacity-disabled)"
const primary =
  "inline-flex h-control-md shrink-0 items-center rounded-base bg-neutral px-2 type-base font-medium text-invert transition-[background-color,transform] hover:bg-neutral-hover active:scale-(--press-scale) disabled:opacity-(--opacity-disabled)"

function openAsk(): string | null {
  const messages = room.messages()
  const last = messages.findLast((m) => m.event?.kind === "browser_control")
  if (!last) return null
  return messages.at(-1) === last || !messages.some((m) => m.sender === "user" && m.sentAt > last.sentAt)
    ? last.body
    : null
}

function BrowserButtons(): JSX.Element {
  return (
    <span class="flex shrink-0 gap-1.5" data-component="browser-buttons">
      <Show
        when={browser()?.takeover}
        fallback={
          <>
            <button
              type="button"
              class={button}
              data-action="browser-watch"
              disabled={browser()?.switching}
              onClick={() => openLive("watch")}
            >
              Watch
            </button>
            <button
              type="button"
              class={primary}
              data-action="browser-takeover"
              disabled={browser()?.switching}
              onClick={() => openLive("control")}
            >
              Take control
            </button>
          </>
        }
      >
        <button type="button" class={button} data-action="browser-open" onClick={() => openLive("control")}>
          Open
        </button>
        <button type="button" class={primary} data-action="browser-handback" onClick={handBack}>
          Release control
        </button>
      </Show>
    </span>
  )
}

export default function BrowserChip(props: { slugs: readonly string[] }): JSX.Element {
  onMount(startBrowser)
  const mine = createMemo(() => browser()?.tabs.filter((t) => props.slugs.includes(t.slug)) ?? [])
  const ask = createMemo(() => openAsk())
  const label = () => {
    const state = browser()
    if (state?.switching) return "Opening browser"
    if (state?.takeover) return "You have control. Agents are paused."
    const first = mine()[0]
    if (first) return `${first.agent} is on ${first.host}`
    return ask() ? "An agent needs you in the browser." : ""
  }
  return (
    <Show when={mine().length > 0 || browser()?.takeover || ask() !== null}>
      <div
        class="mx-1.5 mb-1.5 flex items-center gap-2 rounded-lg bg-input-field py-1 pr-1 pl-2.5 type-base text-primary shadow-(--hairline)"
        role="status"
        data-component="browser-chip"
        data-state={browser()?.switching ? "switching" : browser()?.takeover ? "takeover" : "idle"}
      >
        <span class="font-semibold">Browser</span>
        <span class="min-w-0 flex-1 truncate text-tertiary" data-field="browser-label">
          {label()}
        </span>
        <BrowserButtons />
      </div>
    </Show>
  )
}
