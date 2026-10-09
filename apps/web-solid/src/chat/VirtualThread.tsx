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
import { buildTimelineItems, dayStartOf, keepUnchanged, type Notice, type TimelineItem } from "./lib/grouping"
import { estimateRowHeight } from "./lib/heights"
import { AT_BOTTOM_THRESHOLD_PX, DRIFT_EPSILON, driftCompensation, isAtBottom } from "./lib/drift"
import { dividerLabel, dividerParts } from "./lib/time-label"
import { animate } from "../lib/motion"
import { jumboEmojiClass } from "./lib/reply"
import { MessageRow } from "./ui/MessageRow"
import { DateChip } from "./ui/DateChip"
import { SystemMessage } from "./SystemMessage"
import { AgentThread } from "./AgentThread"
import { MentionLookup } from "./ui/Mention"
import { TypingIndicator } from "./typing/TypingIndicator"
import { cn } from "../lib/cn"
import { createMessageMenu } from "./ui/MessageMenu"
import { ScrollFades } from "./ui/ScrollFades"
import { createImageDialog } from "./ui/image-dialog"
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

/** How far down from the top an inline day pill hides the floating date chip. */
const DIVIDER_ZONE_PX = 48

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
 * The scroller. `overscroll-y-contain` stops a flick at either end from
 * chaining into the shell behind it.
 *
 * The scrollbar is deliberately NOT restated here. `kat.css` ships the app-wide
 * thin scrollbar — `scrollbar-width: thin` on `*`, a 4px transparent
 * `-webkit-scrollbar` with a `--scrollbar-thumb` fill — and the transcript is
 * an ordinary scroller. Repeating those values as `[&::-webkit-scrollbar]:*`
 * utilities would make this one scrollbar disagree with every other one in the
 * product the moment either changed.
 */
const SCROLLER_CLASS =
  "relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain"

/**
 * The centred measure. `pt-12` is the 48px top inset: rows carry their own
 * 16px side padding so the column adds none, and the date chip floats 10px
 * down and is 30px tall — an inset under 40px puts the oldest row underneath
 * it.
 */
const COLUMN_CLASS =
  // `pb-12` is the composer's scrim height. Without it the last message lands
  // inside the 48px band the composer fades above itself, so scrolling to the
  // bottom of a thread would leave the newest message half-dissolved — the
  // scrim is meant to soften content passing under the composer, not to dim
  // the place a conversation ends.
  // `self-start min-h-full`: the scroller is a flex row, and a stretched column would be exactly
  // the scroller's height with the rows overflowing it, which puts `pb-12` off screen.
  "mx-auto flex min-h-full w-full max-w-(--content-max-w) self-start flex-col pt-12 pb-12"

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
  waitingSlugs?: readonly string[]
  waitingDoings?: readonly (string | undefined)[]
  /** A chat with more than one agent: runs show who wrote them, and agents' asides fold. */
  groupChat?: boolean
  /** The room's member slugs. In a group, an agent's message to another member folds into a thread. */
  memberSlugs?: readonly string[]
  /** Who joined and left, as muted lines placed by `seq`. Only a group passes them. */
  notices?: readonly Notice[]
  /** The viewer tapped an emoji on a message. Leave it out and reactions do nothing. */
  onReact?: (messageId: string, emoji: string) => void
  /** Edit one of the human's own messages. Absent: the menu has no edit. */
  onEdit?: (messageId: string) => void
  /** Delete one of the human's own messages. Absent: the menu has no delete. */
  onDelete?: (messageId: string) => void
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
  /** The reader reached the oldest rows held: page in older ones. */
  onNearTop?: () => void
  /** The reader is at the newest message: the store may drop the oldest rows again. */
  onAtLatest?: () => void
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
  /** The agent threads the reader opened, by key. Closed is the default. */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const toggleThread = (key: string) =>
    setExpanded((open) => {
      const next = new Set(open)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const memberSet = createMemo(() => (props.groupChat ? new Set(props.memberSlugs ?? []) : undefined))
  /** The items last built, by key, so an unchanged row keeps its object and the list keeps its DOM. */
  const lastItems = new Map<string, TimelineItem>()
  /*
   * True when the rows changed at the top (an older page came in, or the oldest rows were let
   * go), so the virtualizer keeps the rows on screen where they are. Read when the row count changes.
   */
  let shifted = false
  let firstKey: string | undefined
  let itemsOwner: string | undefined
  const items = createMemo<TimelineItem[]>(() => {
    const next = keepUnchanged(
      lastItems,
      buildTimelineItems(props.messages, props.firstUnreadMessageId, {
        notices: props.groupChat ? props.notices : undefined,
        members: memberSet(),
        expanded: expanded(),
      }),
    )
    const owner = props.scrollKey
    shifted = owner === itemsOwner && firstKey !== undefined && next.length > 0 && next[0].key !== firstKey
    itemsOwner = owner
    firstKey = next[0]?.key
    return next
  })
  const isShifted = () => shifted

  /*
   * A message that arrives while the thread is open eases in (`motion-bubble-in`, 180 ms); an
   * agent's reply grows out of the typing bubble's corner (`motion-reply-in`).
   * Messages that were there when the thread opened, older pages, and the server's echo of a
   * message the reader just sent do not, so nothing replays on a scroll or a reload. Keyed by id:
   * the reader's own send eases in once, under its `local:` id, and its echo arrives under the
   * server's id, which is never fresh for the reader's own message.
   */
  let heard = new Set<string>()
  const fresh = new Set<string>()
  let heardKey: string | undefined
  let primed = false
  createComputed(() => {
    const messages = props.messages
    const key = props.scrollKey
    const now = new Set<string>()
    for (const m of messages) now.add(m.id)
    if (!primed || key !== heardKey) {
      primed = true
      heardKey = key
      heard = now
      fresh.clear()
      return
    }
    for (const m of messages) {
      if (heard.has(m.id)) continue
      const own = m.sender === "user" && !m.id.startsWith("local:")
      // A page of older messages is old, so it never eases in.
      if (own || Date.now() - m.sentAt >= 10_000) continue
      fresh.add(m.id)
      const id = m.id
      setTimeout(() => fresh.delete(id), 600)
    }
    heard = now
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
   *
   * A day divider in the top 48px already names the day under the chip, so the
   * chip steps aside instead of showing the same pill twice. Only the dividers
   * the virtualizer has rendered are measured, once per scroll state.
   */
  const dividerAtTop = createMemo(() => {
    if (!scrollState() || !scrollElement) return false
    const top = scrollElement.getBoundingClientRect().top
    for (const pill of scrollElement.querySelectorAll('[data-component="chat-day-label"]')) {
      const box = pill.getBoundingClientRect()
      if (box.bottom > top && box.top < top + DIVIDER_ZONE_PX) return true
    }
    return false
  })
  const dateChipVisible = createMemo(() => topVisibleDay() !== undefined && !dividerAtTop())

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

  /** Bumped by a jump, so a pin to the end still settling (`pinToLatest`) stops instead of undoing it. */
  let pinRun = 0
  const jumpToMessage = (messageId: string) => {
    pinRun += 1
    // A message inside a folded thread opens the thread first, so there is a row to land on.
    const fold = items().find((item) => item.kind === "thread" && !item.expanded && item.messages.some((m) => m.id === messageId))
    if (fold) toggleThread(fold.key)
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

  /** Rows from the top at which the next older page is asked for. */
  const NEAR_TOP_ROWS = 8
  const commitState = (state: VirtualThreadState) => {
    setScrollState(state)
    recordScroll(state)
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      setPinnedCount(messageCount())
      props.onAtLatest?.()
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
      const state = readState()
      commitState(state)
      // Only a scroll asks for older rows: the first paint starts at the top for a frame.
      if (!firstLoad && state.rangeStart < NEAR_TOP_ROWS && state.scrollSize > state.viewportSize) props.onNearTop?.()
    }
    const onViewportResize = () => {
      // The composer grew (a reply bar, a second line, an attachment) or the window shrank. A
      // reader at the latest message stays there; the committed state is still the old size.
      if (isAtLatest()) scroller.scrollTop = scroller.scrollHeight
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
    const run = ++pinRun
    const step = () => {
      if (!scrollElement || run !== pinRun) return
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
   * One image dialog for the whole transcript, not one per row. The transcript is virtualized, so
   * a per-row dialog would close the moment its message scrolled out of the buffer. A row hands up
   * all of its pictures and the one clicked, so the arrows can move through the rest.
   */
  const viewer = createImageDialog()

  /**
   * One message row: the bubble, its hover actions, and the menu that belongs
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
      /* Pin has no store mutation behind it yet, so it is omitted rather than wired to an empty
         handler. Edit and delete are the human's, on their own stored messages only; edit needs text. */
      onEdit: message.sender === "user" && !message.id.startsWith("local:") && message.body.trim() && props.onEdit
        ? () => props.onEdit!(menu.targetId() ?? message.id)
        : undefined,
      onDelete: message.sender === "user" && !message.id.startsWith("local:") && props.onDelete
        ? () => props.onDelete!(menu.targetId() ?? message.id)
        : undefined,
      onReact: (emoji) => props.onReact?.(menu.targetId() ?? message.id, emoji),
    })
    return (
      <>
        <MessageRow
          message={message}
          bot={props.botById(message.botId)}
          parent={props.replyParent(message.replyToId)}
          parentBot={props.botById(props.replyParent(message.replyToId)?.botId)}
          isRunStart={item.isRunStart}
          isRunEnd={item.isRunEnd}
          runKey={item.runKey}
          hasRunGapBefore={item.hasRunGapBefore}
          group={props.groupChat}
          class={fresh.has(message.id) ? (message.sender === "bot" ? "motion-reply-in" : "motion-bubble-in") : undefined}
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
          onReply={() => aimReplyAt(message.id)}
          onMore={(anchor) => {
            const box = anchor.getBoundingClientRect()
            menu.openAt(message.id, box.left, box.bottom)
          }}
          onContextMenu={menu.onContextMenu}
          onOpenImages={(images, index) => viewer.open(images, index)}
        />
        {menu.view}
      </>
    )
  }

  const renderItem = (item: TimelineItem): JSX.Element => {
    if (item.kind === "day-divider") {
      // Monocode's day separator (AgentTranscript.tsx `DaySeparator`): a soft pill, the day
      // strong and the time faint. Its row keeps the rhythm of SystemMessage.tsx.
      const parts = () => dividerParts(item.firstSentAt, now())
      return (
        <div
          class="flex items-center justify-center px-4 py-3 text-sm"
          role="separator"
          aria-label={dividerLabel(item.firstSentAt, now())}
          data-component="chat-divider"
        >
          <span class="rounded-full bg-[color-mix(in_oklab,var(--text)_7%,transparent)] px-3 py-1 leading-4" data-component="chat-day-label">
            <span class="font-semibold text-[color-mix(in_oklab,var(--text)_75%,transparent)]">{parts().day}</span>{" "}
            <span class="text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{parts().time}</span>
          </span>
        </div>
      )
    }
    if (item.kind === "notice") {
      return <SystemMessage data-component="chat-notice">{item.text}</SystemMessage>
    }
    if (item.kind === "thread") {
      return (
        <AgentThread
          slugs={item.slugs}
          names={item.slugs.map((slug) => props.botById(slug)?.name ?? slug)}
          count={item.messages.length}
          expanded={item.expanded}
          onToggle={() => toggleThread(item.key)}
        />
      )
    }
    if (item.kind === "unread-divider") {
      return (
        <SystemMessage
          variant="divider"
          tone="accent"
          label="New messages"
          data-component="chat-unread-rule"
        >
          New messages
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
          <MentionLookup.Provider value={(slug) => props.botById(slug)}>
          <Show when={hasMessages()}>
            <Virtualizer
              data={items()}
              scrollRef={scrollElement}
              bufferSize={BUFFER_SIZE}
              shift={isShifted()}
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
                <TypingIndicator typists={[...props.waitingNames]} seeds={props.waitingSlugs} doings={props.waitingDoings} group={props.groupChat} />
              </div>
            </Show>
          </Show>
          </MentionLookup.Provider>
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
