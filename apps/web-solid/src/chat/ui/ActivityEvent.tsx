import { A } from "@solidjs/router"
import type { Glyph } from "@kiko/ui/huge-icon"
import { ChatIcon, ClockIcon, GroupIcon, MemoryIcon, MinusIcon, ModelIcon, PlusIcon } from "@kiko/ui/icons"
import { Show } from "solid-js"
import type { ChatMessage } from "../../lib/types"
import { eventDetail, eventText } from "../lib/event-line"
import { EventDivider } from "./EventDivider"

const ICONS: Record<string, Glyph> = {
  created: GroupIcon,
  routine_created: ClockIcon,
  model_changed: ModelIcon,
  compacted: MemoryIcon,
  group_formed: GroupIcon,
  member_added: PlusIcon,
  member_removed: MinusIcon,
  delegated: ChatIcon,
  routine: ClockIcon,
  agent_message: ChatIcon,
}

export function ActivityEvent(props: { message: ChatMessage; name: (slug: string) => string }) {
  const text = () => eventText(props.message, props.name)
  return (
    <Show when={text()}>
      {(t) => (
        <EventDivider icon={ICONS[props.message.event?.kind ?? "created"] ?? GroupIcon} data-message-id={props.message.id}>
          <span class="min-w-0 truncate">{t()}</span>
          <Show when={eventDetail(props.message)}>{(detail) => <span class="min-w-0 shrink-0 truncate text-muted-foreground/70">{detail()}</span>}</Show>
          <Show when={props.message.goto}>
            {(to) => (
              <A class="shrink-0 rounded-md px-1.5 text-foreground hover:bg-accent" href={`/chat/${to()}`}>
                Open chat
              </A>
            )}
          </Show>
        </EventDivider>
      )}
    </Show>
  )
}
