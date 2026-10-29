import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { For, Show, type JSX } from "solid-js"
import type { ChatMessage } from "../../lib/types"
import { room } from "../../state/room"
import { RunTree } from "./RunTree"
import "./run-tree.css"

function Run(props: { message: ChatMessage; who?: string }): JSX.Element {
  return (
    <Show when={room.runWindow(props.message)}>
      {(key) => (
        <RunTree
          windowKey={key()}
          count={props.message.steps}
          endedAt={props.message.sentAt}
          at={props.message.sentAt}
          {...(props.who ? { who: props.who } : {})}
        />
      )}
    </Show>
  )
}

export function BackgroundWork(props: {
  messages: readonly ChatMessage[]
  name: string
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div
      class="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col px-4 py-1"
      data-component="chat-background"
    >
      <Show when={props.messages.length > 1} fallback={<Run message={props.messages[0]!} who={props.name} />}>
        <div class="run-tree">
          <button
            type="button"
            class="run-tree-head"
            aria-expanded={props.expanded}
            data-disclosure=""
            onClick={() => props.onToggle()}
          >
            {props.name} worked in the background {props.messages.length} times
            <span class="run-tree-chevron motion-run-chevron" data-open={props.expanded ? "" : undefined}>
              <RemixIcon icon={ChevronRightIcon} size={12} />
            </span>
          </button>
          <Show when={props.expanded}>
            <div class="run-tree-nest">
              <For each={props.messages}>{(message) => <Run message={message} />}</For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
