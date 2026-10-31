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
  action: "bg-warning-tertiary text-warning",
  working: "bg-warning-tertiary text-warning",
  done: "bg-success-tertiary text-success",
  offline: "bg-tertiary text-secondary",
}

const button =
  "inline-flex h-control-lg shrink-0 cursor-pointer items-center rounded-base px-2.5 type-base whitespace-nowrap transition-[background-color,transform] duration-(--duration-instant) active:scale-(--press-scale) disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"

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
      <Bubble variant="outline" class="w-full max-w-[min(100%,30rem)]">
        <BubbleContent class="flex flex-col gap-2 rounded-lg p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="type-base font-semibold">Computer</span>
            <span
              class={cn("inline-flex h-control-sm items-center gap-1.5 rounded-full px-2 type-sm", PILL[status()])}
              data-field="status"
            >
              <Show when={open()} fallback={<Dot />}>
                <RemixIcon icon={LoaderIcon} class="motion-spin" size={12} />
              </Show>
              {LABEL[status()]}
            </span>
          </div>
          <p class="type-lg text-primary" data-field="reason">
            {event().reason}
          </p>
          <Show when={watching()}>
            <button
              type="button"
              class="relative block w-full cursor-pointer overflow-hidden rounded-lg bg-black/60 outline-none"
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
                  <button
                    type="button"
                    class={cn(button, "bg-tertiary text-primary hover:bg-secondary")}
                    onClick={() => openViewer(event().pc)}
                  >
                    Open
                  </button>
                }
              >
                <button
                  type="button"
                  class={cn(button, "bg-neutral font-medium text-invert hover:bg-neutral-hover")}
                  data-action="computer-takeover"
                  disabled={!computer()?.online || computer()?.caps.input === false}
                  onClick={() => void takeOver(event().pc)}
                >
                  Take over
                </button>
              </Show>
              <button
                type="button"
                class={cn(button, "text-secondary hover:bg-quaternary hover:text-primary")}
                data-action="computer-done"
                onClick={() => void release(event().pc)}
              >
                I’m done
              </button>
              <Show when={status() === "working"}>
                <span class="type-sm text-tertiary">{agentName()} is paused while you work.</span>
              </Show>
            </div>
          </Show>
        </BubbleContent>
      </Bubble>
    </div>
  )
}
