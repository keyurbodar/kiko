import { Show, type JSX } from "solid-js"
import { useApp } from "../../lib/store"
import type { ChatMessage, RosterBot } from "../../lib/types"
import { LinkText } from "./LinkText"
import { Quote } from "./Quote"
import { ReactionStack } from "./ReactionStack"
import { RowTime } from "./RowTime"

/** Which corner the run's tail clamps, and which side the sender sits on. */
function tailRun(isRunStart: boolean, isRunEnd: boolean): "start" | "mid" | "bot" {
  if (isRunEnd) return "bot"
  if (isRunStart) return "start"
  return "mid"
}

/**
 * Who a quote names: the sender of the QUOTED message, never the sender of the
 * message carrying the quote. The viewer is "you" whichever row the quote sits
 * in; an agent resolves through the roster, so the label is that agent's name
 * rather than the generic "bot" the carrying row's own sender would produce.
 */
function quoteSender(message: ChatMessage, ownBot: RosterBot | undefined): string {
  if (message.sender === "user") return "you"
  if (ownBot !== undefined && ownBot.id === message.botId) return ownBot.name
  for (const bot of useApp.bots()) if (bot.id === message.botId) return bot.name
  return "bot"
}

/**
 * One message row: a single bubble, no avatar, no author header, no rail.
 *
 * The row carries `data-side` and `data-run` so a later phase can drive the
 * context menu and the swipe from CSS variables alone, and `data-gap` for the
 * run break. The reply quote, when there is one, is the bubble's FIRST CHILD —
 * the radius on `.chat-quote` is the bubble's radius minus the bubble's own
 * vertical padding, which only lines up if it is nested.
 */
export function Bubble(props: {
  message: ChatMessage
  bot: RosterBot | undefined
  /** The message this one answers. Undefined on a root message. */
  parent: ChatMessage | undefined
  isRunStart: boolean
  isRunEnd: boolean
  hasRunGapBefore: boolean
  /** True when this message is the reply target the composer is holding. */
  replying?: boolean
  jumboClass?: "jumbo-single" | "jumbo-group"
  onOpenReplyTarget: (messageId: string) => void
  /**
   * Omit it until a message menu exists. Bubble never renders a menu itself,
   * and a caller with nothing to open should not have to pass a no-op just to
   * satisfy a required prop.
   */
  onContextMenu?: (event: MouseEvent) => void
  /** Toggles a reaction on this message. Omit it and the badges still render,
   *  they just do not respond to a click. */
  onReact?: (emoji: string) => void
}): JSX.Element {
  return (
    <div
      class="chat-row"
      data-component="chat-row"
      data-message-id={props.message.id}
      data-side={props.message.sender}
      data-run={tailRun(props.isRunStart, props.isRunEnd)}
      data-gap={props.hasRunGapBefore ? "" : undefined}
      data-replying={props.replying ? "" : undefined}
      onContextMenu={props.onContextMenu}
    >
      <div
        class={`chat-bubble chat-bubble--${props.message.sender}${
          props.jumboClass ? ` chat-bubble--${props.jumboClass}` : ""
        }`}
      >
        <Show when={props.parent}>
          {(parent) => (
            <Quote
              parent={parent()}
              label={quoteSender(parent(), props.bot)}
              imageUrl={parent().image?.src}
              onOpenReplyTarget={props.onOpenReplyTarget}
            />
          )}
        </Show>
        <LinkText text={props.message.body} preview={props.message.linkPreview} />
      </div>
      <ReactionStack
        reactions={props.message.reactions ?? []}
        side={props.message.sender}
        onToggle={props.onReact}
      />
      <RowTime sentAt={props.message.sentAt} />
    </div>
  )
}
