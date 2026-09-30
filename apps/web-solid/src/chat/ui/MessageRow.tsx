import { Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { useApp } from "../../lib/store"
import type { ChatMessage, RosterBot } from "../../lib/types"
import { LinkText } from "./LinkText"
import { MessageImage } from "./MessageImage"
import { Quote } from "./Quote"
import { ReactionStack } from "./ReactionBadge"
import { RowTime } from "./RowTime"
import { Bubble, BubbleContent } from "./bubble"

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
 * The row is a COLUMN, not a row-direction flex, and the bubble places itself
 * with `data-align`. That is the primitive's contract: in a column `align-self`
 * is the horizontal axis, which is the one that decides which edge the bubble
 * hugs. A row-direction flex would make the same property mean vertical.
 *
 * The top padding is where the reaction badge is paid for. The badge pulls
 * itself 12px past the bubble's own top edge and its ring adds 2px, so a row
 * with a reaction reserves 15px - one more than the badge needs, because rows
 * sit 1px apart. Without it the badge lands on the message above, which is
 * exactly what a transcript that looks almost right does.
 *
 * The reply quote is the content's FIRST CHILD rather than a sibling: the
 * quote's radius is the bubble's radius minus the bubble's own vertical
 * padding, which only lines up if it is nested.
 */
export function MessageRow(props: {
  message: ChatMessage
  bot: RosterBot | undefined
  /** The message this one answers. Undefined on a root message. */
  parent: ChatMessage | undefined
  isRunStart: boolean
  isRunEnd: boolean
  hasRunGapBefore: boolean
  /** True when this message is the reply target the composer is holding. */
  replying?: boolean
  /** True for the moment after a reply quote jumped here. */
  highlighted?: boolean
  jumboClass?: "jumbo-single" | "jumbo-group"
  /** Merged onto the row root. The row's own box stays a component decision. */
  class?: string
  onOpenReplyTarget: (messageId: string) => void
  /**
   * Omit it until a message menu exists. MessageRow never renders a menu
   * itself, and a caller with nothing to open should not have to pass a no-op
   * just to satisfy a required prop.
   */
  onContextMenu?: (event: MouseEvent) => void
  /** Toggles a reaction on this message. Omit it and the badges still render,
   *  they just do not respond to a click. */
  onReact?: (emoji: string) => void
  /** Opens this message's image full-screen. Omit it and the picture still
   *  renders, it just is not a button that goes anywhere. */
  onOpenImage?: (image: { src: string; name: string }) => void
}): JSX.Element {
  const own = () => props.message.sender === "user"
  return (
    <div
      class={cn(
        "group/row relative mx-auto flex w-full max-w-(--content-max-w) flex-col items-start",
        "px-4 pb-px contain-layout touch-pan-y",
        // `--swipe-x` is NOT defaulted here. It is owned and written by the
        // `SwipeToReply` wrapper above this row, and a custom property declared
        // on an element beats the value it would otherwise inherit — so a
        // `[--swipe-x:0px]` on this row froze every bubble at 0 while the
        // gesture wrote 64px onto the parent, i.e. the swipe did nothing.
        // The default belongs on the element that owns the variable.
        "[--swipe-gutter-rate:0.2] [--chat-time-reveal:0]",
        "hover:[--chat-time-reveal:1] focus-within:[--chat-time-reveal:1]",
        // No ring on the armed reply target. There used to be a
        // `shadow-[0_0_0_2px_var(--accent)]` here, which is a border wearing a
        // shadow's clothes — exactly what this design forbids — and kat draws
        // nothing on the message it is replying to either: the composer's reply
        // bar is the whole indication. `data-replying` survives as the state the
        // probe reads, but it paints nothing.
        // Constant regardless of reactions. A reserved band for the badge was
        // tried and is wrong: padding that appears only once a reaction exists
        // makes the whole transcript jump the moment you react, and kat does
        // not move at all. The badge is absolutely positioned like kat's, so it
        // costs no layout - it may graze the corner of the message above in a
        // tight run, which is exactly what kat's own stacks show.
        props.hasRunGapBefore ? "pt-2" : "pt-px",
        // Swipe-to-reply travels the bubble, not the row: the row stays put so
        // the indicator underneath is revealed rather than pushed along.
        "[&>[data-slot=bubble]]:translate-x-(--swipe-x)",
        // Every bubble keeps the full radius. kat has exactly one bubble radius
        // in its stylesheet and no per-run corner clamp, and the grouped stacks
        // show it: twelve consecutive messages, twelve identical pills. A
        // clamped corner is a tail this design never had.
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
        // An emoji-only message is BARE, kat's `.bubble-bare`: no fill and no
        // padding, so the emoji floats on the canvas instead of sitting in a
        // large coloured pill around a single glyph. `ghost` is that variant.
        variant={props.jumboClass ? "ghost" : own() ? "default" : "secondary"}
        align={own() ? "end" : "start"}
        class={
          // These are whole literals, never assembled from parts, and that is
          // load-bearing: Tailwind generates a class by scanning this file for
          // the finished string. A `[&>…]:${condition ? "text-[42px]" : …}`
          // template is two fragments to the scanner, so it emitted a bare
          // `.text-[42px]` that nothing applied and no bubble-content variant at
          // all — the jumbo size was dead, with the class present in the DOM and
          // matching no rule. Both sizes and both line heights therefore sit here
          // in full, and the line height is scoped to the content because
          // `text-base` sets the content's own line height, which a 42px glyph
          // cannot inherit from the bubble.
          props.jumboClass === "jumbo-single"
            ? "[&>[data-slot=bubble-content]]:text-[42px] [&>[data-slot=bubble-content]]:leading-[1.25]"
            : props.jumboClass === "jumbo-group"
              ? "[&>[data-slot=bubble-content]]:text-[31px] [&>[data-slot=bubble-content]]:leading-[1.25]"
              : undefined
        }
      >
        <BubbleContent
          class={cn(
            // The landing overlay, kat's `.landing-target:after`: one pseudo-
            // element over the painted surface, `opacity: 0` until the row is
            // the jump target. It costs no layout, and only the two rows whose
            // `highlighted` flips ever re-evaluate, which is what keeps a jump
            // cheap.
            //
            // There is deliberately NO transition on the opacity. kat fades
            // its mark, but a transition here is not merely slower, it is
            // broken: the row is created and re-styled as the virtualizer
            // settles the scroll it just performed, and each re-style restarts
            // the fade, so the mark sat invisible for ~900ms and then flashed
            // for the last 200ms of its life. An instant toggle is both correct
            // and the cheapest thing that works.
            "relative",
            "after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:content-['']",
            "after:rounded-[inherit] after:opacity-0",
            own() ? "after:bg-message-user-text" : "after:bg-accent",
            props.highlighted && "after:opacity-[0.22]",
          )}
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
          <MessageImage
            image={props.message.image}
            onOpen={(image) => props.onOpenImage?.(image)}
          />
          <LinkText text={props.message.body} preview={props.message.linkPreview} />
        </BubbleContent>
        <ReactionStack
          reactions={props.message.reactions}
          side={props.message.sender}
          onToggle={props.onReact}
        />
      </Bubble>
      <RowTime sentAt={props.message.sentAt} />
    </div>
  )
}
