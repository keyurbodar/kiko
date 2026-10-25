import { isImage, unnamedFiles } from "../../lib/attachments"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { AlertCircleIcon } from "@kiko/ui/icons"
import { Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage, RosterBot } from "../../lib/types"
import type { QuoteModel } from "../lib/reply"
import { MessageAttachments } from "./Attachments"
import type { DialogImage } from "./image-dialog"
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

const GROUP_GUTTER = "pl-[calc(1rem+40px)]"

const FAILED_ACTION =
  "shrink-0 cursor-pointer rounded-full border border-bad/40 bg-bg px-2 py-0.5 text-hint font-medium text-fg hover:bg-hover"

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
  onOpenImages?: (images: readonly DialogImage[], index: number, from?: Element | null) => void
}): JSX.Element {
  const own = () => props.message.sender === "user"
  const grouped = () => !!props.group && !own() && props.message.botId !== undefined
  const senderName = () => props.bot?.name ?? props.message.botId ?? ""
  const files = () => unnamedFiles(props.message.files ?? [], props.message.body)
  const hasFiles = () => files().length > 0
  const imagesOnly = () =>
    hasFiles() &&
    props.message.body.length === 0 &&
    !props.quote &&
    files().every((file) => isImage({ name: file.name, type: file.type }))
  const photo = () => !!props.message.rich && isPhotoTree(props.message.rich)
  const windowKey = () => (own() ? undefined : room.runWindow(props.message))
  const failed = () => props.message.status === "failed"
  const failure = (): string | undefined => undefined
  return (
    <div
      class={cn(
        "group/row relative mx-auto flex w-full max-w-(--chat-content-max-width) flex-col items-start",
        "px-4 pb-(--row-gap) contain-layout",
        props.hasRunGapBefore ? "pt-(--run-gap)" : "pt-(--row-gap)",
        grouped() && GROUP_GUTTER,
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
      <Show when={grouped()}>
        <RunAvatar seed={props.message.botId!} runKey={props.runKey ?? props.message.id} isRunEnd={props.isRunEnd} />
      </Show>
      <Show when={grouped() && props.isRunStart && !props.jumboClass}>
        <div class="truncate pb-0.5 text-[13px] leading-[18px] font-semibold text-fg2" data-component="chat-sender">
          {senderName()}
        </div>
      </Show>
      <Show when={own() ? undefined : room.thoughtFor(props.message)}>
        {(thought) => <ThoughtRow thought={thought()} />}
      </Show>
      <Bubble
        variant={
          failed() ? "destructive" : props.jumboClass || imagesOnly() ? "ghost" : own() ? "default" : "secondary"
        }
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
          class={cn(
            "relative",
            "after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:content-['']",
            "after:rounded-[inherit] after:opacity-0",
            "after:bg-fg",
            props.highlighted ? "after:opacity-[0.22]" : props.replying && "after:opacity-[0.1]",
          )}
        >
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
          <Show when={failed()}>
            <div
              class="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1"
              data-component="chat-send-failed"
              role="alert"
            >
              <RemixIcon icon={AlertCircleIcon} class="size-3.5 shrink-0 text-bad" />
              <span
                class="min-w-0 flex-1 truncate text-hint font-medium"
                title={failure() ?? undefined}
                data-part="reason"
              >
                {failure() ?? "Didn't send"}
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
        </BubbleContent>
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
      <Show when={windowKey()}>{(key) => <RunTree windowKey={key()} count={props.message.steps} />}</Show>
    </div>
  )
}
