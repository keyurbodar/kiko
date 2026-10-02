import { createEventListener } from "@solid-primitives/event-listener"
import { makeResizeObserver } from "@solid-primitives/resize-observer"
import {
  createComputed,
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
import { dividerLabel } from "./lib/time-label"
import { animate } from "motion"
import { jumboEmojiClass } from "./lib/reply"
import { MessageRow } from "./ui/MessageRow"
import { DateChip } from "./ui/DateChip"
import { SystemMessage } from "./SystemMessage"
import { EmptyState } from "./ui/EmptyState"
import { SwipeToReply } from "./ui/SwipeToReply"
import { TypingIndicator } from "./typing/TypingIndicator"
import { cn } from "../lib/cn"
import { createMessageMenu } from "./ui/MessageMenu"
import { ScrollFades } from "./ui/ScrollFades"
import { createMediaViewer } from "../chat/media/mediaViewer"
import type { DraftBook } from "../warm/drafts"

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

/**
 * How long a jumped-to message stays marked, in ms. Long enough to find the row
 * you asked for, short enough that it is gone before you start reading it -
 * kat's own landing mark works the same way.
 */
const LANDING_MS = 1200

/**
 * How long the shared scroll-to-latest takes. Fast on purpose: both callers
 * are decisions the reader has already made, so this is a snap that keeps the
 * eye oriented, not a journey.
 */
const SCROLL_LATEST_MS = 180

/** A row whose height changed under the reader's eyes, and where to undo it. */
type DriftAnchor = { readonly element: HTMLElement; readonly top: number }

/**
 * The box the floating pieces hang from: the date chip, and the two scrims are absolute children of this, and it is a SIBLING of
 * the scroller rather than its parent.
 *
 * That is not tidiness. An absolutely positioned child of a scroll container is
 * positioned against that container's padding box but travels with its
 * content, so all of them would scroll off the top of the transcript. Here they
 * are children of a box that does not move.
 *
 * `min-h-0` and `flex-1` are load-bearing in a flex parent: without them the
 * stage refuses to shrink below its content, and the transcript grows the page
 * instead of scrolling inside it.
 */
const STAGE_CLASS = "relative flex min-h-0 flex-1 flex-col"

/**
 * The scroller. `touch-pan-y` hands the vertical axis to the row track and
 * leaves the horizontal axis to the swipe-to-reply gesture, which is the only
 * reason a transcript has both. `overscroll-y-contain` stops a flick at either
 * end from chaining into the shell behind it.
 *
 * The scrollbar is deliberately NOT restated here. `kat.css` ships the app-wide
 * thin scrollbar — `scrollbar-width: thin` on `*`, a 4px transparent
 * `-webkit-scrollbar` with a `--scrollbar-thumb` fill — and the transcript is
 * an ordinary scroller. Repeating those values as `[&::-webkit-scrollbar]:*`
 * utilities would make this one scrollbar disagree with every other one in the
 * product the moment either changed.
 */
const SCROLLER_CLASS =
  "relative flex min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-y-contain"

/**
 * The centred measure. `pt-12` is the 48px top inset: rows carry their own
 * 16px side padding so the column adds none, and the date chip floats 10px
 * down and is 30px tall — an inset under 40px puts the oldest row underneath
 * it.
 *
 * The empty state is reached through its `data-component` handle rather than a
 * class, because `ui/EmptyState.tsx` takes no `class` prop and no slice owns
 * it. It is a direct child of this element, so the child combinator is exact.
 */
const COLUMN_CLASS =
  // `pb-12` is the composer's scrim height. Without it the last message lands
  // inside the 48px band the composer fades above itself, so scrolling to the
  // bottom of a thread would leave the newest message half-dissolved — the
  // scrim is meant to soften content passing under the composer, not to dim
  // the place a conversation ends.
  "mx-auto flex w-full max-w-(--content-max-w) flex-col pt-12 pb-12 " +
  "[&>[data-component=chat-empty]]:flex " +
  "[&>[data-component=chat-empty]]:flex-col " +
  "[&>[data-component=chat-empty]]:items-center " +
  "[&>[data-component=chat-empty]]:gap-1.5 " +
  "[&>[data-component=chat-empty]]:px-4 " +
  "[&>[data-component=chat-empty]]:py-12 " +
  "[&>[data-component=chat-empty]]:text-center " +
  "[&>[data-component=chat-empty]]:text-weak " +
  "[&>[data-component=chat-empty]>span]:text-sm " +
  "[&>[data-component=chat-empty]>span]:lowercase"

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
  /** A chat with more than one agent: the typing bubble shows the agent's avatar. */
  groupChat?: boolean
  /** The viewer tapped an emoji on a message. Leave it out and reactions do nothing. */
  onReact?: (messageId: string, emoji: string) => void
  /**
   * Controlled reply target. When this prop is supplied the transcript stops
   * owning the reply and renders whatever the parent says; `null` means no
   * reply. Leave it out and the transcript keeps its internal signal, which is
   * what the harness relies on.
   */
  replyTarget?: string | null
  /**
   * The chat this transcript shows, and the book that remembers where the reader
   * was in each. Together they save the top message and offset as the reader
   * scrolls and put them back when the chat is opened again. Leave them out and
   * the transcript always opens at the end.
   */
  scrollKey?: string
  scrollBook?: Pick<DraftBook, "scroll" | "saveScroll">
  /** Receives a stable jump function for the transcript's scroller. */
  onJumpHandle?: (handle: {
    /** Scroll to a message and mark where it landed. */
    jumpToMessage: (messageId: string) => void
    /** Scroll to the end without marking anything. */
    scrollToLatest: () => void
  }) => void
}): JSX.Element {
  let scrollElement: HTMLDivElement | undefined
  let columnElement: HTMLDivElement | undefined

  const [handle, setHandle] = createSignal<VirtualizerHandle>()
  const items = createMemo<TimelineItem[]>(() =>
    buildTimelineItems(props.messages, props.firstUnreadMessageId),
  )

  /*
   * A message that arrives while the thread is open eases in (`motion-bubble-in`, 180 ms).
   * Messages that were there when the thread opened, older pages, and the server's echo of a
   * message the reader just sent do not, so nothing replays on a scroll or a reload. The
   * signature is sender plus body, with a count, so an echo is matched to its optimistic row.
   */
  const heard = new Map<string, number>()
  const fresh = new Set<string>()
  let heardKey: string | undefined
  let primed = false
  createComputed(() => {
    const messages = props.messages
    const key = props.scrollKey
    const sign = (m: (typeof messages)[number]) => `${m.sender}|${m.body}`
    if (!primed || key !== heardKey) {
      primed = true
      heardKey = key
      heard.clear()
      fresh.clear()
      for (const m of messages) heard.set(sign(m), (heard.get(sign(m)) ?? 0) + 1)
      return
    }
    const now = new Map<string, number>()
    for (const m of messages) {
      const sig = sign(m)
      const n = (now.get(sig) ?? 0) + 1
      now.set(sig, n)
      if (n > (heard.get(sig) ?? 0) && Date.now() - m.sentAt < 10_000) {
        fresh.add(m.id)
        const id = m.id
        setTimeout(() => fresh.delete(id), 600)
      }
    }
    heard.clear()
    for (const [sig, n] of now) heard.set(sig, n)
  })

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

  /**
   * The reply the rows are marked against, controlled or not.
   *
   * The split is on `undefined`, not on `??`: `null` is a real answer here -
   * it is how a parent says "clear the reply after sending" - so `??` would
   * fall through to the internal signal on exactly the value that means no
   * reply, and the composer could never dismiss its own bar.
   */
  const activeReply = createMemo<string | null>(() =>
    props.replyTarget !== undefined ? props.replyTarget : replyTarget(),
  )

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
   * The chip is the sticky day label: whenever there is a day at the top of
   * the viewport, it names that day and opens the calendar on click. It used
   * to show only over today, which meant the one thing it exists for - telling
   * a reader who has scrolled back which day they are in - never happened.
   */
  const dateChipVisible = createMemo(() => topVisibleDay() !== undefined)

  /**
   * Which message the last reply-quote jump landed on.
   *
   * Held by id rather than as a boolean, because the row that was marked before
   * has to clear in the same commit. Expiry is a generation counter rather than
   * a stored timer handle: a second jump bumps it, so an older deadline can no
   * longer clear the newer mark, and there is no handle to thread around or
   * type. Cleanup bumps it too, which neutralises anything still in flight so a
   * disposed thread is never written to.
   */
  const [landed, setLanded] = createSignal<string | undefined>()
  let landingGeneration = 0
  /** The in-flight scroll-to-latest, so a second call cancels the first. */
  let scrollControls: { stop: () => void } | undefined
  onCleanup(() => scrollControls?.stop())
  onCleanup(() => {
    landingGeneration += 1
  })

  const jumpToMessage = (messageId: string) => {
    const index = items().findIndex(
      (item) => item.kind === "message" && item.message.id === messageId,
    )
    if (index < 0) return
    handle()?.scrollToIndex(index, { align: "start" })
    const generation = (landingGeneration += 1)
    setLanded(messageId)
    setTimeout(() => {
      if (landingGeneration === generation) setLanded(undefined)
    }, LANDING_MS)
    props.onJumpToMessage(messageId)
  }

  /**
   * Hand the parent the very function the rows already use to open a reply
   * quote. Not a wrapper and not a second path: the scroll and the landing
   * highlight are written in one place, and anything that jumped by another
   * route would move the transcript without ever marking where it landed.
   */
  onMount(() => {
    props.onJumpHandle?.({ jumpToMessage, scrollToLatest })
  })

  /** The calendar asks for a day; the transcript answers with its first row. */
  const days = createMemo(() => new Set(props.messages.map((m) => dayStartOf(m.sentAt))))
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

  /** The chat whose saved position has been put back, or given up on. */
  let restoredFor: string | undefined

  /** True when the rows on screen belong to the chat `scrollKey` names. */
  const showsKey = () => {
    const first = props.messages[0]
    return props.scrollKey !== undefined && first !== undefined && first.threadId === props.scrollKey
  }

  /** Remember the top row and how far into it the view sits. At the end it remembers nothing. */
  const recordScroll = (state: VirtualThreadState) => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor !== key || !showsKey()) return
    const virtualizer = handle()
    if (!virtualizer) return
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      props.scrollBook.saveScroll(key, null)
      return
    }
    const list = items()
    for (let i = clampIndex(state.rangeStart, list.length); i < list.length; i += 1) {
      const item = list[i]
      if (item.kind !== "message") continue
      props.scrollBook.saveScroll(key, {
        messageId: item.message.id,
        offset: Math.round(state.scrollOffset - virtualizer.getItemOffset(i)),
      })
      return
    }
  }

  /**
   * Put the reader back where they were. Returns true when it took over the
   * scroll, so the caller does not also pin to the end.
   */
  const restorePosition = (): boolean => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor === key || !showsKey()) return false
    restoredFor = key
    const saved = props.scrollBook.scroll(key)
    if (!saved) return false
    const index = items().findIndex((item) => item.kind === "message" && item.message.id === saved.messageId)
    if (index < 0) return false
    let tries = 0
    const apply = () => {
      const virtualizer = handle()
      if (!virtualizer) {
        if ((tries += 1) < 10) requestAnimationFrame(apply)
        return
      }
      virtualizer.scrollToIndex(index, { align: "start", offset: saved.offset })
      seedAnchor()
      commitState(readState())
    }
    apply()
    return true
  }

  const commitState = (state: VirtualThreadState) => {
    setScrollState(state)
    recordScroll(state)
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      setPinnedCount(messageCount())
    }
    props.onStateChange(state)
  }

  /**
   * The one scroll-to-latest, used by the composer scroll-down control and by sending.
   *
   * Animated at 180ms rather than the browser's `behavior: "smooth"`: that
   * curve is long enough to read as a journey, and both callers are things the
   * reader has already decided on — the pill means "take me to the end", and
   * sending means "I am done here". A snap that keeps the eye oriented is the
   * whole job.
   *
   * Deliberately NOT `jumpToMessage`: that one also arms the landing highlight,
   * which is right when you clicked a quote to go find a message and wrong when
   * the message is one you just wrote. Routing the send through it flashed the
   * highlight on every message sent.
   */
  const scrollToLatest = () => {
    if (!scrollElement) return
    const element = scrollElement
    scrollControls?.stop()
    scrollControls = animate(element.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight), {
      duration: SCROLL_LATEST_MS / 1000,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (value) => {
        element.scrollTop = value
      },
    })
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
    const scroller = scrollElement
    const column = columnElement
    if (!scroller || !column) return
    const onScroll = () => {
      seedAnchor()
      commitState(readState())
    }
    const onViewportResize = () => {
      seedAnchor()
      commitState(readState())
    }
    let driftQueued = false
    const queueDriftCancel = () => {
      if (driftQueued) return
      driftQueued = true
      requestAnimationFrame(() => {
        driftQueued = false
        cancelDrift()
      })
    }
    const viewportObserver = makeResizeObserver(onViewportResize)
    viewportObserver.observe(scroller)
    createEventListener(() => scroller, "scroll", onScroll, { passive: true })
    const mutations = new MutationObserver(queueDriftCancel)
    mutations.observe(column, { childList: true, subtree: true })
    const heights = new MutationObserver(queueDriftCancel)
    for (const child of Array.from(column.children)) {
      heights.observe(child, { attributes: true, attributeFilter: ["style"] })
    }
    const tree = new MutationObserver((entries) => {
      for (const entry of entries) {
        for (const node of Array.from(entry.addedNodes)) {
          if (node instanceof HTMLElement) {
            heights.observe(node, { attributes: true, attributeFilter: ["style"] })
          }
        }
      }
    })
    tree.observe(column, { childList: true })
    onCleanup(() => {
      viewportObserver.unobserve(scroller)
      mutations.disconnect()
      heights.disconnect()
      tree.disconnect()
      props.scrollRef(undefined)
    })
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
  let lastOwner: unknown
  createEffect(
    on(items, () => {
      // With a scroll key the chat is the owner. Without one, the array is.
      const owner: unknown = props.scrollKey ?? props.messages
      if (owner !== lastOwner) {
        lastOwner = owner
        firstLoad = true
        anchor = undefined
        setPinnedCount(messageCount())
        if (scrollElement) scrollElement.scrollTop = scrollElement.scrollHeight
      }
      const restoring = restorePosition()
      const wasAtLatest = firstLoad || isAtLatest()
      seedAnchor()
      if (restoring) {
        firstLoad = false
      } else if (firstLoad) {
        firstLoad = false
        if (items().length > 0) pinToLatest()
      } else if (wasAtLatest) {
        pinToLatest()
      }
      commitState(readState())
    }),
  )

  /**
   * One media viewer for the whole transcript, not one per row.
   *
   * It has to outlive the row that opened it: the transcript is virtualized, so
   * a per-row viewer would be destroyed the moment its message scrolled out of
   * the buffer, taking an open dialog with it. `menu.view` is per row for
   * exactly the opposite reason — a menu belongs to one message and should die
   * with it.
   *
   * The row hands up the whole album and the index that was clicked, not a
   * single source: a viewer is a slideshow over a message's media, and a
   * callback that flattened it to one item could not offer the next picture.
   * The body travels with it as the caption, which is the only place it can
   * come from — the viewer has no access to the transcript's items.
   */
  const viewer = createMediaViewer()

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
      messageFor: (id) => {
        for (const entry of items()) {
          if (entry.kind === "message" && entry.message.id === id) return entry.message
        }
        return message
      },
      side: message.sender,
      onReply: () => aimReplyAt(menu.targetId() ?? message.id),
      /* Pin, edit and delete have no store mutation behind them yet, so they are
         omitted rather than wired to an empty handler: a menu item that accepts
         a click and then does nothing is worse than a missing one. */
      onReact: (emoji) => props.onReact?.(menu.targetId() ?? message.id, emoji),
    })
    return (
      <>
        <SwipeToReply onCommit={() => aimReplyAt(message.id)}>
          <MessageRow
            message={message}
            bot={props.botById(message.botId)}
            parent={props.replyParent(message.replyToId)}
            parentBot={props.botById(props.replyParent(message.replyToId)?.botId)}
            isRunStart={item.isRunStart}
            isRunEnd={item.isRunEnd}
            hasRunGapBefore={item.hasRunGapBefore}
            group={props.groupChat}
            class={fresh.has(message.id) ? "motion-bubble-in" : undefined}
            highlighted={landed() === message.id}
            replying={activeReply() === message.id}
            /*
             * Classified here, at the one place a row is built. The helper was
             * imported and then never called, so `jumboClass` was always
             * undefined and every emoji-only message drew an ordinary bubble:
             * the jumbo sizes and the bare `ghost` variant were both in
             * `MessageRow` and neither could ever be reached.
             */
            jumboClass={jumboEmojiClass(message.body)}
            onOpenReplyTarget={jumpToMessage}
            onReact={(emoji) => props.onReact?.(message.id, emoji)}
            onContextMenu={menu.onContextMenu}
            onOpenMedia={(media, index) => viewer.open(media, index, message.body)}
          />
        </SwipeToReply>
        {menu.view}
      </>
    )
  }

  const renderItem = (item: TimelineItem): JSX.Element => {
    if (item.kind === "day-divider") {
      return (
        <SystemMessage
          variant="divider"
          label={dividerLabel(item.firstSentAt, now())}
          data-component="chat-divider"
        >
          <span class="font-medium" data-component="chat-day-label">
            {dividerLabel(item.firstSentAt, now())}
          </span>
        </SystemMessage>
      )
    }
    if (item.kind === "unread-divider") {
      return (
        <SystemMessage
          variant="divider"
          tone="accent"
          label="new messages"
          data-component="chat-unread-rule"
        >
          new messages
        </SystemMessage>
      )
    }
    return renderMessage(item)
  }

  const hasMessages = () => items().length > 0

  return (
    <div class={STAGE_CLASS} data-component="chat-stage">
      <div
        class={SCROLLER_CLASS}
        data-component="chat-scroll"
        data-virtual-scroll=""
        ref={(element) => {
          scrollElement = element
          props.scrollRef(element)
        }}
      >
        <div
          class={COLUMN_CLASS}
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
              <div
                class={cn(
                  "mx-auto flex w-full max-w-(--content-max-w) px-4 pb-(--row-gap)",
                  // The next bubble of the agent's run, or a new run after the human.
                  props.messages.at(-1)?.sender === "bot" ? "pt-(--row-gap)" : "pt-(--run-gap)",
                )}
                data-component="chat-typing-row"
              >
                <TypingIndicator typists={[...props.waitingNames]} avatar={props.groupChat} />
              </div>
            </Show>
          </Show>
        </div>
      </div>

      <DateChip
        dayStart={topVisibleDay() ?? dayStartOf(now())}
        now={now()}
        visible={dateChipVisible()}
        onJumpToDay={jumpToDay}
        hasDay={(day) => days().has(day) || day === dayStartOf(now())}
      />
      <ScrollFades
        showTop={(scrollState()?.scrollOffset ?? 0) > 0}
        showBottom={!isAtLatest()}
      />

      {viewer.view}
    </div>
  )
}
