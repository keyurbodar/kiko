import { A } from "@solidjs/router"
import { CollapsibleV2 as Collapsible } from "@kiko/ui/v2/collapsible-v2"
import { ArrowUpRightIcon, ChevronDownIcon, GitBranchIcon, ListTodoIcon } from "lucide-solid"
import { Show } from "solid-js"
import type { ChatMessage } from "../../lib/types"

export function ActivityEvent(props: { message: ChatMessage }) {
  const event = () => props.message.event
  const title = () => {
    const e = event()
    if (e?.kind === "created" && "title" in e) return `${e.title} is ready`
    if (e?.kind === "delegated" && "to" in e) return `@${e.from} → @${e.to} · ${e.title}`
    if (e?.kind === "subagent" && "state" in e) return `${e.state === "started" ? "Background work started" : e.state === "done" ? "Background work completed" : e.state === "failed" ? "Background work failed" : "Background work stopped"} · ${e.title}`
    if (e?.kind === "routine" && "title" in e) return String(e.title)
    return props.message.goto ? "Chat is ready" : props.message.body
  }
  return <div class="mx-auto w-full max-w-(--chat-content-max-width) px-4 py-1" data-component="activity-event" data-message-id={props.message.id}>
    <Collapsible>
      <div class="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
        <Collapsible.Trigger class="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring">
          <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
            <Show when={props.message.goto} fallback={<Show when={event()?.kind === "delegated"} fallback={<ListTodoIcon class="size-3.5" />}><GitBranchIcon class="size-3.5" /></Show>}><ArrowUpRightIcon class="size-3.5" /></Show>
          </span>
          <span class="truncate">{title()}</span><ChevronDownIcon class="size-3 shrink-0 text-secondary-label" />
        </Collapsible.Trigger>
        <Show when={props.message.goto}>{(to) => <A class="shrink-0 rounded-md px-2 py-1 text-xs text-foreground hover:bg-accent" href={`/chat/${to()}`}>Open chat</A>}</Show>
      </div>
      <Collapsible.Content class="ml-8 max-h-48 overflow-auto py-1 text-sm text-muted-foreground"><p class="break-words">{props.message.body}</p></Collapsible.Content>
    </Collapsible>
  </div>
}
