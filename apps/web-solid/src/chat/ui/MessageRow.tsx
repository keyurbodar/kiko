import { createResource, createSignal, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage, MediaItem, RosterBot } from "../../lib/types"
import { formatTimeOfDay } from "../lib/dayLabel"
import { draftLinkUrl } from "../../composer/link-draft"
import { resolveLinkPreview } from "../lib/linkPreview"
import { replySummary } from "../lib/reply"
import { MessageDocuments } from "./Documents"
import { MessageMedia } from "./Media"
import { Quote } from "./Quote"
import { ReactionStack } from "./ReactionBadge"
import { RichText } from "./RichText"
import { Collapsible } from "../Collapsible"
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
  if (message.sender === "user") return "you"
  return parentBot?.name ?? "bot"
}

export function MessageRow(props: {
  message: ChatMessage
  bot: RosterBot | undefined
  parent: ChatMessage | undefined
  /** The author of `parent`, when an agent wrote it. */
  parentBot?: RosterBot

  isRunStart: boolean
  isRunEnd: boolean
  hasRunGapBefore: boolean
  replying?: boolean
  highlighted?: boolean
  jumboClass?: "jumbo-single" | "jumbo-group"
  class?: string
  onOpenReplyTarget: (messageId: string) => void
  onContextMenu?: (event: MouseEvent) => void
  onReact?: (emoji: string) => void
  onOpenMedia?: (items: readonly MediaItem[], index: number) => void
}): JSX.Element {
  const own = () => props.message.sender === "user"
  const hasMedia = () => (props.message.media?.length ?? 0) > 0
  const hasDocuments = () => (props.message.documents?.length ?? 0) > 0
  const hasAttachment = () => hasMedia() || hasDocuments()
  const floatingTime = () =>
    hasMedia() &&
    !hasDocuments() &&
    props.message.body.length === 0 &&
    props.message.webPage === undefined
  // A message carries its text only, so the card comes from the server's preview of its first
  // link. The lookup is cached per URL, so scrolling a transcript never refetches.
  const [linked] = createResource(
    () => (props.message.webPage === undefined && !hasMedia() ? draftLinkUrl(props.message.body) : null),
    (url) => resolveLinkPreview(url),
  )
  const webPage = () => props.message.webPage ?? linked.latest ?? undefined
  const [fittedWidth, setFittedWidth] = createSignal<number | undefined>(undefined)
  const captionStyle = () => {
    const width = fittedWidth()
    return width === undefined ? undefined : { "max-width": `${width}px` }
  }
  return (
    <div
      class={cn(
        "group/row relative mx-auto flex w-full max-w-(--content-max-w) flex-col items-start",
        "px-4 pb-(--row-gap) contain-layout touch-pan-y",
        "[--swipe-gutter-rate:0.2]",
        props.hasRunGapBefore ? "pt-(--run-gap)" : "pt-(--row-gap)",
        "[&>[data-slot=bubble]]:translate-x-(--swipe-x)",
        props.class,
      )}
      data-component="chat-row"
      data-message-id={props.message.id}
      data-side={props.message.sender}
      data-run={tailRun(props.isRunStart, props.isRunEnd)}
      data-gap={props.hasRunGapBefore ? "" : undefined}
      data-replying={props.replying ? "" : undefined}
      onContextMenu={props.onContextMenu}
    >
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
          class={cn(
            "relative",
            "after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:content-['']",
            "after:rounded-[inherit] after:opacity-0",
            own() ? "after:bg-message-user-text" : "after:bg-accent",
            props.highlighted && "after:opacity-[0.22]",
            hasAttachment() && "p-0",
          )}
        >
          <Show when={props.parent}>
            {(parent) => (
              <div class={hasAttachment() ? "px-2 pt-2" : undefined}>
                <Quote
                  parent={parent()}
                  label={quoteSender(parent(), props.parentBot)}
                  summary={replySummary(parent())}
                  side={props.message.sender}
                  onOpenReplyTarget={props.onOpenReplyTarget}
                  class={hasAttachment() ? "mb-0" : undefined}
                />
              </div>
            )}
          </Show>
          <Show when={props.message.media}>
            {(media) => (
              <MessageMedia
                items={media()}
                hasText={props.message.body.trim().length > 0}
                onOpen={(index) => props.onOpenMedia?.(media(), index)}
                fittedWidth={setFittedWidth}
              />
            )}
          </Show>
          <Show when={hasDocuments() ? props.message.documents : undefined}>
            {(documents) => <MessageDocuments items={documents()} side={props.message.sender} />}
          </Show>
          <Show when={props.message.body.length > 0 || webPage() !== undefined}>
            <div
              class={hasAttachment() ? "px-3 pt-[5px] pb-[7px]" : undefined}
              style={captionStyle()}
            >
              <Collapsible messageId={props.message.id} side={own() ? "user" : "assistant"}>
                <RichText
                  text={props.message.body.length > 0 ? props.message.body : undefined}
                  webPage={props.message.media === undefined ? webPage() : undefined}
                />
              </Collapsible>
            </div>
          </Show>
          <Show when={floatingTime()}>
            <time
              class="pointer-events-none absolute end-1 bottom-1 z-[1] rounded-full bg-black/35 px-1.5 text-[11px] leading-[18px] whitespace-nowrap text-white"
              data-component="chat-media-time"
              datetime={new Date(props.message.sentAt).toISOString()}
            >
              {formatTimeOfDay(props.message.sentAt)}
            </time>
          </Show>
        </BubbleContent>
        <ReactionStack
          reactions={props.message.reactions}
          side={props.message.sender}
          onToggle={props.onReact}
        />
      </Bubble>
    </div>
  )
}
