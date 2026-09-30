import { createEventListener } from "@solid-primitives/event-listener"
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import type { ChatMessage, RosterBot } from "../lib/types"
import { buildTimelineItems, dayStartOf, type TimelineItem } from "./lib/grouping"
import { estimateRowHeight } from "./lib/heights"
import { AT_BOTTOM_THRESHOLD_PX, DRIFT_EPSILON, driftCompensation, isAtBottom } from "./lib/drift"
import { dayChipLabel, formatTimeOfDay } from "./lib/dayLabel"
import { useApp } from "../lib/store"
import { jumboEmojiClass } from "./lib/reply"
import { Bubble } from "./ui/Bubble"
import { DateChip } from "./ui/DateChip"
import { UnreadRule } from "./ui/UnreadRule"
import { EmptyState } from "./ui/EmptyState"
import { SwipeToReply } from "./ui/SwipeToReply"
import { TypingRow } from "./ui/TypingRow"
import { JumpToLatest } from "./ui/JumpToLatest"
import { createMessageMenu } from "./ui/MessageMenu"
import { ScrollFades } from "./ui/ScrollFades"
import "./chat.css"

/**
 * What the shell knows about the reader's position. Everything the transcript
 * needs to decide whether it is pinned, where the top of the viewport falls in
 * row terms, and whether either scrim has anything to hide.
 */
export interface VirtualThreadState {
  readonly scrollOffset: number
  readonly scrollSize: number
  readonly viewportSize: number
  /** First row intersecting the viewport. */
  readonly rangeStart: number
  /** Last row intersecting the viewport. */
  readonly rangeEnd: number
}

/**
 * Rows rendered beyond the viewport, in px. A transcript is read by scrolling,
 * not flinging, and a thumb that lands on a blank strip reads as a broken
 * scroll. 600 is a little over a tall viewport of prose.
 */
const BUFFER_SIZE = 600

/**
 * Slack when asking "am I at the floor?". The virtualizer reports a scroll
 * size that is a sum of measured and estimated rows, so the last pixel or two
 * is not worth chasing; the reader's intent is what matters.
 */
const BOTTOM_EPSILON = 2

/** How long the bottom-pin loop keeps re-asserting itself, in ms. */
const PIN_SETTLE_MS = 400

/** A row whose height changed under the reader's eyes, and where to undo it. */
type DriftAnchor = { readonly element: HTMLElement; readonly top: number }

const ROW_SELECTOR = '[data-component="chat-vrow"]'

const clampIndex = (index: number, count: number): number =>
  Math.min(Math.max(index, 0), Math.max(count - 1, 0))

export function VirtualThread(props: {
  messages: readonly ChatMessage[]
  botById: (botId: string | undefined) => RosterBot | undefined
  replyParent: (messageId: string | undefined) => ChatMessage | undefined
  firstUnreadMessageId: string | null
  onJumpToMessage: (messageId: string) => void
  onReplyTarget: (messageId: string) => void
  scrollRef: (element: HTMLDivElement | undefined) => void
  onStateChange: (state: VirtualThreadState) => void
  waitingNames: readonly string[]
}): JSX.Element {
  let scrollElement: HTMLDivElement | undefined
  let columnElement: HTMLDivElement | undefined

  const [handle, setHandle] = createSignal<VirtualizerHandle>()
  const items = createMemo<TimelineItem[]>(() =>
    buildTimelineItems(props.messages, props.firstUnreadMessageId),
  )

  /**
   * The message a reply is aimed at. The thread holds it rather than only
   * forwarding the callback because a gesture that commits into nothing is
   * indistinguishable from a gesture that did not fire: the swipe has to leave
   * the target visibly marked even before a composer exists to consume it.
   */
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null)
  const aimReplyAt = (messageId: string) => {
    setReplyTarget(messageId)
    props.onReplyTarget(messageId)
  }

  // Declared before every reader of it. Solid evaluates these memos eagerly
  // during the first render, so a signal read above its own declaration is a
  // TDZ crash at mount, not a lint warning.
  const [scrollState, setScrollState] = createSignal<VirtualThreadState>()

  /**
   * The one day the reader is currently in: the day of the topmost row on
   * screen. A day divider is its own answer; a message answers for itself; an
   * unread rule belongs to whatever follows it, because the rule sits above the
   * first unread message.
   */
  const topVisibleDay = createMemo<number | undefined>(() => {
    const list = items()
    if (list.length === 0) return undefined
    const top = clampIndex(scrollState()?.rangeStart ?? 0, list.length)
    for (let i = top; i < list.length; i += 1) {
      const item = list[i]
      if (item.kind === "day-divider") return item.dayStart
      if (item.kind === "message") return dayStartOf(item.message.sentAt)
    }
    return undefined
  })

  /**
   * "Now" as a signal, because a transcript is read across midnight and
   * "today" is a claim about the clock. A value captured once at mount would
   * keep labelling yesterday's rows "today" for the rest of the session, and
   * would pin the date chip to the wrong day.
   *
   * Ticked on a minute rather than a second: every use here resolves to a
   * calendar day, so a minute is the finest resolution that can change an
   * answer, and a reader is never going to notice a label that turns over
   * within sixty seconds of local midnight.
   */
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000)
    onCleanup(() => clearInterval(clock))
  })

  /**
   * The chip only earns its place over today. Once yesterday's rows are on
   * screen the reader already has the date in the transcript, and a chip
   * reading "today" while they read yesterday would be a lie.
   */
  const dateChipVisible = createMemo(() => topVisibleDay() === dayStartOf(now()))

  const jumpToMessage = (messageId: string) => {
    const index = items().findIndex(
      (item) => item.kind === "message" && item.message.id === messageId,
    )
    if (index < 0) return
    handle()?.scrollToIndex(index, { align: "start" })
    props.onJumpToMessage(messageId)
  }

  /** The calendar asks for a day; the transcript answers with its first row. */
  const jumpToDay = (dayStart: number) => {
    const index = items().findIndex(
      (item) => item.kind === "message" && dayStartOf(item.message.sentAt) === dayStart,
    )
    if (index < 0) return
    handle()?.scrollToIndex(index, { align: "start" })
    seedAnchor()
    commitState(readState())
  }

  /**
   * How many messages the transcript held the last time the reader was at the
   * end. Anything above it arrived while they were reading history, and is what
   * the pill counts. Counted in messages rather than rows: the transcript
   * interleaves day dividers, and "3 new messages" should not become 4 because
   * one of them crossed midnight.
   */
  const messageCount = createMemo(
    () => items().reduce((total, item) => total + (item.kind === "message" ? 1 : 0), 0),
  )
  const [pinnedCount, setPinnedCount] = createSignal(0)

  const isAtLatest = () => {
    const state = scrollState()
    return state
      ? isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)
      : true
  }

  const commitState = (state: VirtualThreadState) => {
    setScrollState(state)
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      setPinnedCount(messageCount())
    }
    props.onStateChange(state)
  }

  const arrivals = createMemo(() =>
    isAtLatest() ? 0 : Math.max(0, messageCount() - pinnedCount()),
  )

  const jumpToLatest = () => {
    if (!scrollElement) return
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "auto" })
  }

  let anchor: DriftAnchor | undefined

  const readState = (): VirtualThreadState => {
    const virtualizer = handle()
    const count = items().length
    const scrollOffset = scrollElement?.scrollTop ?? virtualizer?.scrollOffset ?? 0
    const viewportSize = scrollElement?.clientHeight ?? virtualizer?.viewportSize ?? 0
    const scrollSize = scrollElement?.scrollHeight ?? virtualizer?.scrollSize ?? 0
    if (count === 0) {
      return { scrollOffset, scrollSize, viewportSize, rangeStart: 0, rangeEnd: 0 }
    }
    return {
      scrollOffset,
      scrollSize,
      viewportSize,
      rangeStart: clampIndex(virtualizer?.findItemIndex(scrollOffset) ?? 0, count),
      rangeEnd: clampIndex(virtualizer?.findItemIndex(scrollOffset + viewportSize) ?? 0, count),
    }
  }

  /**
   * Pin the reading line to a row.
   *
   * A virtualized transcript has no stable offset: rows above the viewport are
   * unmounted, so "where am I" can only be answered by a real element. The
   * reading line is the top of the viewport (less the epsilon), and the anchor
   * is the first row at or below it, recorded as an offset from the column so
   * it survives the column itself being measured.
   *
   * A previously held anchor is preferred as long as it has not drifted above
   * the line, which keeps the same row pinned across a re-measure instead of
   * letting the choice wander onto whatever is nearest.
   */
  const seedAnchor = () => {
    if (!scrollElement || !columnElement) return
    const top = scrollElement.scrollTop
    const base = columnElement.getBoundingClientRect().top
    const readingLine = base + top - DRIFT_EPSILON

    const held = anchor?.element.isConnected === true ? anchor.element : undefined
    const heldRect = held?.getBoundingClientRect()
    if (held && heldRect && heldRect.top >= readingLine) {
      anchor = { element: held, top: heldRect.top - base }
      return
    }

    const rows = columnElement.querySelectorAll<HTMLElement>(ROW_SELECTOR)
    anchor = undefined
    for (const node of rows) {
      const rect = node.getBoundingClientRect()
      if (rect.top >= readingLine) {
        anchor = { element: node, top: rect.top - base }
        return
      }
    }
    // Nothing starts below the line, which means the reader is inside the last
    // row or past the end. Hold the first row still on screen instead.
    for (const node of rows) {
      const rect = node.getBoundingClientRect()
      if (rect.bottom > base + top) {
        anchor = { element: node, top: rect.top - base }
        return
      }
    }
  }

  /**
   * Undo a height change that happened under the reader.
   *
   * The virtualizer measures a row after it renders and grows the content, which
   * pushes every row below it down. Scrolled to the middle of a long thread
   * that reads as the whole conversation jumping. The anchor element is the one
   * row whose position the reader is relying on, so measuring where it drifted
   * and scrolling by exactly that puts it back.
   *
   * At the bottom there is nothing to preserve — the reader's position is "the
   * end", and the end is meant to move.
   */
  const cancelDrift = () => {
    if (!scrollElement || !columnElement) return
    const state = readState()
    const held = anchor?.element.isConnected === true ? anchor : undefined
    if (!held) {
      seedAnchor()
      commitState(state)
      return
    }
    const atBottom =
      state.scrollOffset + state.viewportSize >= state.scrollSize - BOTTOM_EPSILON
    const drift =
      held.element.getBoundingClientRect().top -
      columnElement.getBoundingClientRect().top -
      held.top
    const compensation = driftCompensation(drift, atBottom)
    if (compensation === 0) {
      seedAnchor()
      commitState(state)
      return
    }
    const virtualizer = handle()
    if (virtualizer) virtualizer.scrollBy(compensation)
    else scrollElement.scrollBy(0, compensation)
    requestAnimationFrame(seedAnchor)
    commitState(readState())
  }

  onMount(() => {
    if (!scrollElement || !columnElement) return
    const onScroll = () => {
      seedAnchor()
      commitState(readState())
    }
    // The viewport growing is not a height change under the reader: nothing
    // moved relative to the top, so there is nothing to cancel.
    const onViewportResize = () => {
      seedAnchor()
      commitState(readState())
    }
    // The column growing IS one: rows above the reading line changed size.
    //
    // Deferred to the next frame on purpose. Cancelling drift means writing
    // `scrollTop`, and a ResizeObserver callback that mutates layout is exactly
    // what the observer loop forbids: the browser reports "loop completed with
    // undelivered notifications", drops the rest of that frame's observations,
    // and the correction lands a frame late — which is the same visible jump it
    // was meant to prevent.
    let driftQueued = false
    const queueDriftCancel = () => {
      if (driftQueued) return
      driftQueued = true
      requestAnimationFrame(() => {
        driftQueued = false
        cancelDrift()
      })
    }
    const viewportObserver = new ResizeObserver(onViewportResize)
    const contentObserver = new ResizeObserver(queueDriftCancel)
    viewportObserver.observe(scrollElement)
    contentObserver.observe(columnElement)
    createEventListener(() => scrollElement, "scroll", onScroll, { passive: true })
    onCleanup(() => {
      viewportObserver.disconnect()
      contentObserver.disconnect()
    })
  })

  onCleanup(() => {
    props.scrollRef(undefined)
  })

  /**
   * Hold the end of the thread while it settles.
   *
   * Appending a message grows the content, and the browser resolves that over a
   * frame or two as the arriving row is measured. A single scrollTo lands where
   * the end was, not where it is going, so the pin is re-asserted for a short
   * window.
   */
  const pinToLatest = () => {
    const until = performance.now() + PIN_SETTLE_MS
    const step = () => {
      if (!scrollElement) return
      scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "auto" })
      if (performance.now() < until) {
        requestAnimationFrame(step)
        return
      }
      seedAnchor()
      commitState(readState())
    }
    step()
  }

  /**
   * Follow the thread down, but only for a reader who was already following it.
   *
   * Whether they were is read BEFORE the new rows are measured, because by the
   * time the layout settles the content has already grown and anyone looks like
   * they were at the bottom. So the decision is made against the count the
   * reader last sat at, and the first load is its own case: there is no
   * previous position to respect, and a thread opens at its end.
   */
  let firstLoad = true
  createEffect(
    on(items, () => {
      const wasAtLatest = isAtLatest()
      seedAnchor()
      if (firstLoad) {
        firstLoad = false
        if (items().length > 0) pinToLatest()
      } else if (wasAtLatest) {
        pinToLatest()
      }
      commitState(readState())
    }),
  )

  /**
   * One message row: the swipe wrapper, the bubble, and the menu that belongs
   * to that specific message.
   *
   * The menu is per row rather than one menu for the transcript because it acts
   * on a message — reply, copy, react, pin, edit, delete all name one id. It is
   * uncontrolled and driven by a replayed `contextmenu` event, so a row that is
   * virtualized away takes its own closed menu with it and costs nothing.
   */
  const renderMessage = (item: TimelineItem & { kind: "message" }): JSX.Element => {
    const message = item.message
    const menu = createMessageMenu({
      message,
      side: message.sender,
      onReply: () => aimReplyAt(message.id),
      /* Pin, edit and delete have no store mutation behind them yet, so they are
         omitted rather than wired to an empty handler: a menu item that accepts
         a click and then does nothing is worse than a missing one. */
      onReact: (emoji) => useApp.toggleReaction(message.id, emoji),
    })
    return (
      <>
        <SwipeToReply side={message.sender} onCommit={() => aimReplyAt(message.id)}>
          <Bubble
            message={message}
            bot={props.botById(message.botId)}
            parent={props.replyParent(message.replyToId)}
            isRunStart={item.isRunStart}
            isRunEnd={item.isRunEnd}
            hasRunGapBefore={item.hasRunGapBefore}
            jumboClass={jumboEmojiClass(message.body)}
            replying={replyTarget() === message.id}
            onOpenReplyTarget={jumpToMessage}
            onReact={(emoji) => useApp.toggleReaction(message.id, emoji)}
            onContextMenu={menu.onContextMenu}
          />
        </SwipeToReply>
        {menu.view}
      </>
    )
  }

  const renderItem = (item: TimelineItem): JSX.Element => {
    if (item.kind === "day-divider") {
      return (
        <div class="chat-divider" data-component="chat-divider">
          <span class="chat-divider__label">{dayChipLabel(item.dayStart, now())}</span>
          <span class="chat-divider__time">{formatTimeOfDay(item.dayStart)}</span>
        </div>
      )
    }
    if (item.kind === "unread-divider") {
      return <UnreadRule retiring={false} />
    }
    return renderMessage(item)
  }

  const hasMessages = () => items().length > 0

  return (
    <div class="chat-stage" data-component="chat-stage">
      <div
        class="chat-scroller"
        data-component="chat-scroll"
        data-virtual-scroll=""
        ref={(element) => {
          scrollElement = element
          props.scrollRef(element)
        }}
      >
        <div
          class={`chat-column chat-column--flush`}
          data-component="chat-column"
          data-virtual-column=""
          ref={(element) => {
            columnElement = element
          }}
        >
          <Show
            when={hasMessages()}
            fallback={<EmptyState />}
          >
            <Virtualizer
              data={items()}
              scrollRef={scrollElement}
              bufferSize={BUFFER_SIZE}
              ref={setHandle}
            >
              {(item) => (
                <div
                  data-component="chat-vrow"
                  style={{
                    "contain-intrinsic-size": `auto ${estimateRowHeight(item)}px`,
                  }}
                >
                  {renderItem(item)}
                </div>
              )}
            </Virtualizer>
            {/*
              The typing row is a row, not an overlay: it sits in the flow after
              the last message so it pushes nothing and is read in place. It is
              not part of `items` because it is not a message — it has no id,
              no run and no height in the height table.
            */}
            <Show when={props.waitingNames.length > 0}>
              <TypingRow typists={props.waitingNames} />
            </Show>
          </Show>
        </div>
      </div>

      <DateChip
        dayStart={dayStartOf(now())}
        now={now()}
        visible={dateChipVisible()}
        onJumpToDay={jumpToDay}
      />

      <ScrollFades
        showTop={(scrollState()?.scrollOffset ?? 0) > 0}
        showBottom={!isAtLatest()}
      />

      <JumpToLatest
        arrivals={arrivals()}
        visible={!isAtLatest()}
        onJump={jumpToLatest}
      />

    </div>
  )
}
