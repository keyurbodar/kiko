import { unnamedFiles } from "../../lib/attachments"
import { Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage, RosterBot } from "../../lib/types"
import type { QuoteModel } from "../lib/reply"
import { MessageAttachments } from "./Attachments"
import type { DialogImage } from "./chat-images"
import { Quote } from "./Quote"
import { ReactionStack } from "./ReactionBadge"
import { MessageActions } from "./MessageActions"
import { room } from "../../state/room"
import { RunTree } from "../run/RunTree"
import { ThoughtRow } from "../thinking/Thinking"
import { RichText } from "./RichText"
import { Collapsible } from "../Collapsible"
import { isPhotoTree } from "../rich/model"
import { RunAvatar } from "./RunAvatar"
import { Bubble, BubbleContent, type BubblePosition } from "./bubble"
import { RichText as RichTree } from "../rich/RichText"

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

export const GROUP_GUTTER = "pl-[calc(1rem+36px)]"

const bubbleTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

const FAILED_ACTION =
  "shrink-0 cursor-pointer rounded-micro px-1 font-medium text-[var(--text-100)] underline decoration-[var(--border-200)] underline-offset-2 transition-colors duration-(--dur-hover) hover:decoration-[var(--text-200)]"

export function MessageRow(props: {
  message: ChatMessage
  bot: RosterBot | undefined
  quote: QuoteModel | null

  isRunStart: boolean
  isRunEnd: boolean
  runKey?: string
  hasRunGapBefore: boolean
  group?: boolean
  replying?: boolean
  highlighted?: boolean
  jumboClass?: "jumbo-single" | "jumbo-group"
  class?: string
  onOpenReplyTarget: (messageId: string, seq?: number) => void
  onContextMenu?: (event: MouseEvent) => void
  onReact?: (emoji: string) => void
  onReply?: () => void
  onMore?: (anchor: HTMLElement) => void
  onOpenImages?: (images: readonly DialogImage[], index: number) => void
}): JSX.Element {
  const own = () => props.message.sender === "user"
  const agent = () => !own() && props.message.botId !== undefined
  const grouped = () => !!props.group && agent()
  const senderName = () => props.bot?.name ?? props.message.botId ?? ""
  const files = () => unnamedFiles(props.message.files ?? [], props.message.body)
  const hasFiles = () => files().length > 0
  const photo = () => !!props.message.rich && isPhotoTree(props.message.rich)
  const windowKey = () => (own() ? undefined : room.runWindow(props.message))
  const named = () => grouped() && props.isRunStart
  const nameInBubble = () => named() && !props.jumboClass
  const failed = () => props.message.status === "failed"
  const bare = () => props.message.body.length === 0 && hasFiles() && !props.quote
  const timed = () => !props.jumboClass && !photo() && props.message.body.length > 0
  return (
    <div
      class={cn(
        "group/row relative mx-auto flex w-full max-w-(--chat-content-max-width) flex-col items-start",
        "px-4 pb-(--row-gap) contain-layout",
        props.hasRunGapBefore ? "pt-(--run-gap)" : "pt-(--row-gap)",
        agent() && GROUP_GUTTER,
        props.class,
      )}
      data-component="chat-row"
      data-message-id={props.message.id}
      data-side={props.message.sender}
      data-failed={failed() ? "" : undefined}
      data-run={tailRun(props.isRunStart, props.isRunEnd)}
      data-run-key={props.runKey}
      data-run-first={props.isRunStart ? "" : undefined}
      data-gap={props.hasRunGapBefore ? "" : undefined}
      data-replying={props.replying ? "" : undefined}
      onContextMenu={props.onContextMenu}
    >
      <Show when={agent()}>
        <RunAvatar seed={props.message.botId!} runKey={props.runKey ?? props.message.id} isRunEnd={props.isRunEnd} />
      </Show>
      <Show when={named() && !nameInBubble() && !props.jumboClass}>
        <div
          class="truncate pb-0.5 text-hint font-semibold text-fg2"
          style={{ "padding-left": "var(--bubble-pad-x)" }}
          data-component="chat-sender"
        >
          {senderName()}
        </div>
      </Show>
      <Show when={own() ? undefined : room.thoughtFor(props.message)}>
        {(thought) => <ThoughtRow thought={thought()} />}
      </Show>
      <Show when={windowKey()}>
        {(key) => <RunTree windowKey={key()} count={props.message.steps} endedAt={props.message.sentAt} />}
      </Show>
      <Bubble
        variant={props.jumboClass || bare() ? "ghost" : own() ? "default" : "secondary"}
        data-failed={failed() ? "" : undefined}
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
          data-timed={timed() ? "" : undefined}
          class={cn(
            "relative",
            "after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:content-['']",
            "after:rounded-[inherit] after:opacity-0",
            "after:bg-fg",
            props.highlighted ? "after:opacity-[0.22]" : props.replying && "after:opacity-[0.1]",
          )}
        >
          <Show when={nameInBubble()}>
            <div
              class="mb-px truncate text-[13.5px] leading-[18px] font-semibold text-[var(--text-200)]"
              data-component="chat-sender"
            >
              {senderName()}
            </div>
          </Show>
          <Show when={props.quote}>
            {(quote) => <Quote quote={quote()} onOpenReplyTarget={props.onOpenReplyTarget} />}
          </Show>
          <Show when={props.message.initiative}>
            {(reason) => (
              <div
                class="px-(--bubble-pad-x) pt-1 text-label leading-5 text-[color-mix(in_oklab,currentColor_55%,transparent)]"
                data-component="noticed"
              >
                Noticed: {reason()}
              </div>
            )}
          </Show>
          <Show when={hasFiles() ? files() : undefined}>
            {(files) => (
              <div class={props.message.body.length > 0 ? "mb-2" : undefined}>
                <MessageAttachments files={files()} roomId={props.message.threadId} onOpenImages={props.onOpenImages} />
              </div>
            )}
          </Show>
          <Show when={props.message.body.length > 0}>
            <Collapsible messageId={props.message.id} fixed={photo()}>
              <Show
                when={props.message.rich?.length ? props.message.rich : undefined}
                fallback={<RichText text={props.message.body} />}
              >
                {(tree) => (
                  <Suspense fallback={<RichText text={props.message.body} />}>
                    <RichTree tree={tree()} class="bubble-rich" />
                  </Suspense>
                )}
              </Show>
            </Collapsible>
          </Show>
          <Show when={timed()}>
            <span class="bubble-time" data-component="bubble-time">
              {bubbleTime(props.message.sentAt)}
            </span>
          </Show>
        </BubbleContent>
        <Show when={failed()}>
          <div
            class="flex flex-wrap items-center justify-end gap-x-1.5 text-caption"
            data-component="chat-send-failed"
            role="alert"
          >
            <span class="text-danger" data-part="reason">
              Not sent
            </span>
            <button
              type="button"
              class={FAILED_ACTION}
              data-action="retry-send"
              onClick={() => room.retryRun(props.message.id)}
            >
              Retry
            </button>
            <button
              type="button"
              class={FAILED_ACTION}
              data-action="delete-send"
              onClick={() => room.deleteMessage(props.message.id)}
            >
              Delete
            </button>
          </div>
        </Show>
        <ReactionStack reactions={props.message.reactions} side={props.message.sender} onToggle={props.onReact} />
        <Show when={props.onReact && props.onReply && props.onMore}>
          <MessageActions
            side={props.message.sender}
            copyText={props.message.body}
            onReact={(emoji) => props.onReact!(emoji)}
            onReply={() => props.onReply!()}
            onMore={(anchor) => props.onMore!(anchor)}
          />
        </Show>
      </Bubble>
    </div>
  )
}
