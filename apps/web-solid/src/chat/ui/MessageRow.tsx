import { lazy, Show, Suspense, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { cn } from "../../lib/cn"
import type { ChatMessage, RosterBot } from "../../lib/types"
import { quoteSummary, replySummary } from "../lib/reply"
import { MessageAttachments } from "./Attachments"
import type { DialogImage } from "./image-dialog"
import { Quote } from "./Quote"
import { ReactionStack } from "./ReactionBadge"
import { MessageActions } from "./MessageActions"
import { RichText } from "./RichText"
/* The parsed tree's renderer loads after first paint; until it lands a bubble shows its plain text. */
const RichTree = lazy(() => import("../rich/RichText").then((m) => ({ default: m.RichText })))
import { Collapsible } from "../Collapsible"
import { identityLook } from "../../lib/identity"
import { RunAvatar } from "./RunAvatar"
import { Bubble, BubbleContent, type BubblePosition } from "./bubble"

function bubblePosition(isRunStart: boolean, isRunEnd: boolean): BubblePosition {
  if (isRunStart && isRunEnd) return "only"
  if (isRunStart) return "first"
  if (isRunEnd) return "last"
  return "middle"
}

function tailRun(isRunStart: boolean, isRunEnd: boolean): "start" | "mid" | "bot" {
  if (isRunEnd) return "bot"
  if (isRunStart) return "start"
  return "mid"
}

/** The quoted message's author. The parent's own author is passed in, so the row never looks up a roster. */
function quoteSender(message: ChatMessage, parentBot: RosterBot | undefined): string {
  if (message.sender === "user") return "You"
  return parentBot?.name ?? "Bot"
}

/** Width of the avatar gutter in a group chat: the 32px run avatar and an 8px gap. */
const GROUP_GUTTER = "pl-[calc(1rem+40px)]"

export function MessageRow(props: {
  message: ChatMessage
  bot: RosterBot | undefined
  parent: ChatMessage | undefined
  /** The author of `parent`, when an agent wrote it. */
  parentBot?: RosterBot

  isRunStart: boolean
  isRunEnd: boolean
  /** The id of the run's first message. The run avatar measures from that row. */
  runKey?: string
  hasRunGapBefore: boolean
  /** The room has more than one agent: say who wrote each run. */
  group?: boolean
  replying?: boolean
  highlighted?: boolean
  jumboClass?: "jumbo-single" | "jumbo-group"
  class?: string
  onOpenReplyTarget: (messageId: string) => void
  onContextMenu?: (event: MouseEvent) => void
  onReact?: (emoji: string) => void
  /** Arms a reply to this message, from the hover actions. */
  onReply?: () => void
  /** Opens the message menu at the hover actions' "…" button. */
  onMore?: (anchor: HTMLElement) => void
  onOpenImages?: (images: readonly DialogImage[], index: number) => void
}): JSX.Element {
  const own = () => props.message.sender === "user"
  const grouped = () => !!props.group && !own() && props.message.botId !== undefined
  const senderName = () => props.bot?.name ?? props.message.botId ?? ""
  const hasFiles = () => (props.message.files?.length ?? 0) > 0
  return (
    <div
      class={cn(
        "group/row relative mx-auto flex w-full max-w-(--content-max-w) flex-col items-start",
        "px-4 pb-(--row-gap) contain-layout",
        props.hasRunGapBefore ? "pt-(--run-gap)" : "pt-(--row-gap)",
        grouped() && GROUP_GUTTER,
        props.class,
      )}
      data-component="chat-row"
      data-message-id={props.message.id}
      data-side={props.message.sender}
      data-run={tailRun(props.isRunStart, props.isRunEnd)}
      data-run-key={props.runKey}
      data-run-first={props.isRunStart ? "" : undefined}
      data-gap={props.hasRunGapBefore ? "" : undefined}
      data-replying={props.replying ? "" : undefined}
      onContextMenu={props.onContextMenu}
    >
      <Show when={grouped()}>
        <RunAvatar seed={props.message.botId!} runKey={props.runKey ?? props.message.id} isRunEnd={props.isRunEnd} />
      </Show>
      <Bubble
        variant={props.jumboClass ? "ghost" : own() ? "default" : "secondary"}
        align={own() ? "end" : "start"}
        position={bubblePosition(props.isRunStart, props.isRunEnd)}
        class={
          props.jumboClass === "jumbo-single"
            ? "[&>[data-slot=bubble-content]]:text-[42px] [&>[data-slot=bubble-content]]:leading-[1.25]"
            : props.jumboClass === "jumbo-group"
              ? "[&>[data-slot=bubble-content]]:text-[31px] [&>[data-slot=bubble-content]]:leading-[1.25]"
              : undefined
        }
      >
        <BubbleContent
          measureLines={!hasFiles() && !props.parent && !props.jumboClass}
          class={cn(
            "relative",
            "after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:content-['']",
            "after:rounded-[inherit] after:opacity-0",
            own() ? "after:bg-message-user-text" : "after:bg-accent",
            props.highlighted && "after:opacity-[0.22]",
          )}
        >
          <Show when={grouped() && props.isRunStart && !props.jumboClass}>
            <div
              class="truncate pb-0.5 text-md leading-5 font-semibold"
              style={{ color: identityLook(props.message.botId!).color }}
              data-component="chat-sender"
            >
              {senderName()}
            </div>
          </Show>
          <Show when={props.parent}>
            {(parent) => (
              <Quote
                parent={parent()}
                label={quoteSender(parent(), props.parentBot)}
                tint={props.group && parent().botId !== undefined ? identityLook(parent().botId!).color : undefined}
                summary={props.message.quote ? quoteSummary(props.message.quote) : replySummary(parent())}
                side={props.message.sender}
                onOpenReplyTarget={props.onOpenReplyTarget}
              />
            )}
          </Show>
          <Show when={props.message.initiative}>
            {(reason) => (
              <div class="px-(--bubble-pad-x) pt-1 text-sm leading-5 text-[color-mix(in_oklab,currentColor_55%,transparent)]" data-component="noticed">
                Noticed: {reason()}
              </div>
            )}
          </Show>
          <Show when={hasFiles() ? props.message.files : undefined}>
            {(files) => (
              <div class={props.message.body.length > 0 ? "mb-2" : undefined}>
                <MessageAttachments files={files()} roomId={props.message.threadId} onOpenImages={props.onOpenImages} />
              </div>
            )}
          </Show>
          <Show when={props.message.body.length > 0}>
            <Collapsible messageId={props.message.id}>
              {/* Parsed messages (section 6.4) draw from the tree for both senders. A message without
                  a tree, a human's until the send path stores one, falls back to its plain text. */}
              <Show when={props.message.rich?.length ? props.message.rich : undefined} fallback={<RichText text={props.message.body} />}>
                {(tree) => (
                  <Suspense fallback={<RichText text={props.message.body} />}>
                    <RichTree tree={tree()} class="bubble-rich" />
                  </Suspense>
                )}
              </Show>
            </Collapsible>
          </Show>
          <Show when={props.message.goto}>
            {(to) => (
              <div class="px-3 pb-2">
                <A href={`/chat/${to()}`} class="inline-flex h-8 items-center rounded-full bg-btn px-3 text-sm text-text" data-action="open-made-chat">
                  Open chat
                </A>
              </div>
            )}
          </Show>
        </BubbleContent>
        <ReactionStack
          reactions={props.message.reactions}
          side={props.message.sender}
          onToggle={props.onReact}
        />
        <Show when={props.onReact && props.onReply && props.onMore}>
          <MessageActions
            side={props.message.sender}
            onReact={(emoji) => props.onReact!(emoji)}
            onReply={() => props.onReply!()}
            onMore={(anchor) => props.onMore!(anchor)}
          />
        </Show>
      </Bubble>
    </div>
  )
}
