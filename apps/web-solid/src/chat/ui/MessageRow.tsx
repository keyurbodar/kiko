import { createResource, createSignal, lazy, Show, Suspense, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import { cn } from "../../lib/cn"
import type { ChatMessage, MediaItem, RosterBot } from "../../lib/types"
import { formatTimeOfDay } from "../lib/dayLabel"
import { draftLinkUrl } from "../../composer/link-draft"
import { isLinkOnly, peekLinkPreview, resolveLinkPreview } from "../lib/linkPreview"
import { quoteSummary, replySummary } from "../lib/reply"
import { MessageDocuments } from "./Documents"
import { MessageMedia } from "./Media"
import { Quote } from "./Quote"
import { ReactionStack } from "./ReactionBadge"
import { RichText } from "./RichText"
import { WebPageCard } from "./WebPageCard"
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
  onOpenMedia?: (items: readonly MediaItem[], index: number) => void
}): JSX.Element {
  const own = () => props.message.sender === "user"
  const grouped = () => !!props.group && !own() && props.message.botId !== undefined
  const senderName = () => props.bot?.name ?? props.message.botId ?? ""
  const hasMedia = () => (props.message.media?.length ?? 0) > 0
  const hasDocuments = () => (props.message.documents?.length ?? 0) > 0
  const hasAttachment = () => hasMedia() || hasDocuments()
  const floatingTime = () =>
    hasMedia() &&
    !hasDocuments() &&
    props.message.body.length === 0 &&
    props.message.webPage === undefined
  // The server attaches the card for the first link to the message. Until it does (a send in
  // flight, an older message) the card comes from the shared preview cache: synchronously when
  // the composer or an earlier row already looked the link up, so a sent link never blinks.
  const linkUrl = () => (props.message.webPage === undefined && !hasMedia() ? draftLinkUrl(props.message.body) : null)
  const [linked] = createResource(
    () => {
      const url = linkUrl()
      return url && peekLinkPreview(url) === undefined ? url : null
    },
    (url) => resolveLinkPreview(url),
  )
  const webPage = () => {
    if (props.message.webPage) return props.message.webPage
    const url = linkUrl()
    return (url ? peekLinkPreview(url) : undefined) ?? linked.latest ?? undefined
  }
  // A message that is only a link shows the card alone, with no bubble, as kat does.
  const cardOnly = () => !props.parent && !hasAttachment() && isLinkOnly(props.message.body, webPage())
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
      <Show when={!cardOnly()}>
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
          measureLines={!hasAttachment() && !props.parent && !props.jumboClass}
          class={cn(
            "relative",
            "after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:content-['']",
            "after:rounded-[inherit] after:opacity-0",
            own() ? "after:bg-message-user-text" : "after:bg-accent",
            props.highlighted && "after:opacity-[0.22]",
            hasAttachment() && "p-0",
          )}
        >
          <Show when={grouped() && props.isRunStart && !props.jumboClass}>
            <div
              class={cn("truncate text-md leading-5 font-semibold", hasAttachment() ? "px-3 pt-2" : "pb-0.5")}
              style={{ color: identityLook(props.message.botId!).color }}
              data-component="chat-sender"
            >
              {senderName()}
            </div>
          </Show>
          <Show when={props.parent}>
            {(parent) => (
              <div class={hasAttachment() ? "px-2 pt-2" : undefined}>
                <Quote
                  parent={parent()}
                  label={quoteSender(parent(), props.parentBot)}
                  tint={props.group && parent().botId !== undefined ? identityLook(parent().botId!).color : undefined}
                  summary={props.message.quote ? quoteSummary(props.message.quote) : replySummary(parent())}
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
          <Show when={props.message.body.length > 0}>
            <div
              class={hasAttachment() ? "px-3 py-2" : undefined}
              style={captionStyle()}
            >
              <Collapsible messageId={props.message.id}>
                {/* An agent's markdown arrives parsed (section 6.4): code, lists, quotes, and inline
                    formatting draw from the tree. The human's own text stays plain. */}
                <Show
                  when={!own() && props.message.rich?.length ? props.message.rich : undefined}
                  fallback={
<RichText text={props.message.body} />
                  }
                >
                  {(tree) => (
                    <Suspense fallback={<RichText text={props.message.body} />}>
                      <RichTree tree={tree()} class="bubble-rich" />
                    </Suspense>
                  )}
                </Show>
              </Collapsible>
            </div>
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
          <Show when={floatingTime()}>
            <time
              class="pointer-events-none absolute end-1 bottom-1 z-[1] rounded-full bg-black/35 px-1.5 text-xs leading-[18px] whitespace-nowrap text-white"
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
      </Show>
      {/* The link card is its own block under the bubble, on the sender's side, as in kat. */}
      <Show when={props.message.media === undefined ? webPage() : undefined}>
        {(page) => (
          <WebPageCard page={page()} class={cn(own() && "self-end", cardOnly() && "mt-0")}>
            <Show when={cardOnly()}>
              <time
                class="pointer-events-none absolute end-2 top-2 z-[1] rounded-full bg-black/35 px-1.5 text-xs leading-[18px] whitespace-nowrap text-white"
                data-component="chat-media-time"
                datetime={new Date(props.message.sentAt).toISOString()}
              >
                {props.message.status === "sending" ? "Sending" : formatTimeOfDay(props.message.sentAt)}
              </time>
            </Show>
          </WebPageCard>
        )}
      </Show>
      <Show when={cardOnly() && props.message.reactions?.length}>
        <div class={cn("relative", own() && "self-end")}>
          <ReactionStack reactions={props.message.reactions} side={props.message.sender} onToggle={props.onReact} />
        </div>
      </Show>
    </div>
  )
}
