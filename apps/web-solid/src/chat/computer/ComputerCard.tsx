import { RemixIcon } from "@kiko/ui/remix-icon"
import { LoaderIcon } from "@kiko/ui/icons"
import { createMemo, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { agentDisplayName } from "../../lib/names"
import { room } from "../../state/room"
import { user } from "../../state/user"
import type { ChatMessage } from "../../lib/types"
import { computerById, openViewer, release, takeOver, viewerFor } from "../computers"
import { Bubble, BubbleContent } from "../ui/bubble"
import LiveScreen from "./LiveScreen"

type Status = "action" | "working" | "done" | "offline"

const LABEL: Record<Status, string> = {
  action: "Action needed",
  working: "Working",
  done: "Done",
  offline: "Offline",
}

const PILL: Record<Status, string> = {
  action: "bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-warn",
  working: "bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-warn",
  done: "bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] text-ok",
  offline: "bg-[color-mix(in_oklab,var(--fg)_8%,transparent)] text-fg2",
}

const button =
  "h-9 shrink-0 cursor-pointer rounded-full px-4 text-ui font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"

function Dot(): JSX.Element {
  return <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
}

export default function ComputerCard(props: { message: ChatMessage }): JSX.Element {
  const event = () => props.message.event as { agent: string; pc: string; reason: string }
  const computer = () => computerById(event().pc)
  const latest = createMemo(
    () =>
      room.messages().findLast((m) => {
        const e = m.event as { kind?: string; pc?: string } | undefined
        return e?.kind === "computer_control" && e.pc === event().pc
      })?.id === props.message.id,
  )
  const status = (): Status => {
    const pc = computer()
    if (!latest() || !pc) return "done"
    if (!pc.online) return "offline"
    if (pc.busy === true || pc.holder === "human") return "working"
    return pc.agent ? "action" : "done"
  }
  const open = () => status() === "action" || status() === "working"
  const ratio = () => {
    const display = computer()?.displays[0]
    return display?.height ? display.width / display.height : 16 / 10
  }
  const agentName = () => agentDisplayName(event().agent, user.agents())
  const watching = () => open() && computer()?.online === true && viewerFor() !== event().pc

  return (
    <div
      class="mx-auto flex w-full max-w-(--chat-content-max-width) px-4 pb-(--row-gap)"
      data-component="computer-card"
      data-status={status()}
      data-message-id={props.message.id}
    >
      <Bubble variant="secondary" class="w-full max-w-[min(100%,30rem)]">
        <BubbleContent class="flex flex-col gap-2.5 p-3.5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-ui font-semibold">Computer</span>
            <span
              class={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-ui", PILL[status()])}
              data-field="status"
            >
              <Show when={open()} fallback={<Dot />}>
                <RemixIcon icon={LoaderIcon} class="motion-spin" size={12} />
              </Show>
              {LABEL[status()]}
            </span>
          </div>
          <p class="text-msg leading-snug" data-field="reason">
            {event().reason}
          </p>
          <Show when={watching()}>
            <button
              type="button"
              class="relative block w-full cursor-pointer overflow-hidden rounded-pop bg-black/60 outline-none"
              style={{ "aspect-ratio": String(ratio()) }}
              aria-label="Open the screen"
              data-action="computer-open"
              onClick={() => openViewer(event().pc)}
            >
              <LiveScreen pcId={event().pc} interactive={false} class="pointer-events-none" />
            </button>
          </Show>
          <Show when={open()}>
            <div class="flex flex-wrap items-center gap-2">
              <Show
                when={status() === "action"}
                fallback={
                  <button type="button" class={cn(button, "bg-bg text-fg")} onClick={() => openViewer(event().pc)}>
                    Open
                  </button>
                }
              >
                <button
                  type="button"
                  class={cn(button, "bg-fg text-bg")}
                  data-action="computer-takeover"
                  disabled={!computer()?.online || computer()?.caps.input === false}
                  onClick={() => takeOver(event().pc)}
                >
                  Take over
                </button>
              </Show>
              <button
                type="button"
                class={cn(button, "bg-[color-mix(in_oklab,var(--fg)_10%,transparent)] text-fg")}
                data-action="computer-done"
                onClick={() => release(event().pc)}
              >
                I’m done
              </button>
              <Show when={status() === "working"}>
                <span class="text-label text-fg2">{agentName()} is paused while you work.</span>
              </Show>
            </div>
          </Show>
        </BubbleContent>
      </Bubble>
    </div>
  )
}
