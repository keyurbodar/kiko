import { createEventListener } from "@solid-primitives/event-listener"
import { makeResizeObserver } from "@solid-primitives/resize-observer"
import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  type JSX,
} from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import type { SystemEvent } from "@kiko/protocol"
import type { ChatMessage, RosterBot } from "../lib/types"
import { buildTimelineItems, dayStartOf, keepUnchanged, type TimelineItem } from "./lib/grouping"
import { estimateRowHeight } from "./lib/heights"
import { AT_BOTTOM_THRESHOLD_PX, isAtBottom } from "./lib/drift"
import { dividerParts } from "./lib/time-label"
import { jumboEmojiClass, quoteOf } from "./lib/reply"
import { MessageRow } from "./ui/MessageRow"
import { DateChip } from "./ui/DateChip"
import { ActivityEvent } from "./ui/ActivityEvent"
import { SystemRow } from "./ui/SystemRow"
import { agentDisplayName } from "../lib/names"
import { AgentThread } from "./AgentThread"
import { MentionLookup } from "./ui/Mention"
import { TypingIndicator } from "./typing/TypingIndicator"
import { cn } from "../lib/cn"
import { createMessageMenu } from "./ui/MessageMenu"
import { ScrollFades } from "./ui/ScrollFades"
import { chatImages } from "./ui/chat-images"
import { createImageDialog, provideThreadImages } from "./ui/image-dialog"
import type { DraftBook } from "../warm/drafts"

export interface VirtualThreadState {
  readonly scrollOffset: number
  readonly scrollSize: number
  readonly viewportSize: number
  readonly rangeStart: number
  readonly rangeEnd: number
}

const BUFFER_SIZE = 600

const LANDING_MS = 1200

const DATE_CHIP_IDLE_MS = 1200

const READER_SCROLL_MS = 250

const DATE_CHIP_EDGE_PX = 56


const STAGE_CLASS = "relative flex min-h-0 flex-1 flex-col"

const SCROLLER_CLASS =
  "relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain"

const COLUMN_CLASS =
  "mx-auto flex min-h-full w-full max-w-(--chat-content-max-width) self-start flex-col pt-12 pb-12"

const clampIndex = (index: number, count: number): number =>
  Math.min(Math.max(index, 0), Math.max(count - 1, 0))

export function VirtualThread(props: {
  messages: readonly ChatMessage[]
  botById: (botId: string | undefined) => RosterBot | undefined
  replyParent: (messageId: string | undefined) => ChatMessage | undefined
  firstUnreadMessageId: string | null
  onJumpToMessage: (messageId: string) => void
  onReplyTarget: (messageId: string) => void
  /** A quote's original is not in the window: load it by its seq, then show it. */
  onJumpToSeq?: (messageId: string, seq: number) => void
  scrollRef: (element: HTMLDivElement | undefined) => void
  onStateChange: (state: VirtualThreadState) => void
  waitingNames: readonly string[]
  waitingSlugs?: readonly string[]
  waitingDoings?: readonly (string | undefined)[]
  groupChat?: boolean
  memberSlugs?: readonly string[]
  onReact?: (messageId: string, emoji: string) => void
  onEdit?: (messageId: string) => void
  onDelete?: (messageId: string) => void
  replyTarget?: string | null
  onNearTop?: () => void
  onAtLatest?: () => void
  /** The reader scrolled away from the newest message: the window must stop trimming its oldest rows. */
  onLeftLatest?: () => void
  scrollKey?: string
  scrollBook?: Pick<DraftBook, "scroll" | "saveScroll"> & Partial<Pick<DraftBook, "ready">>
  onJumpHandle?: (handle: {
    jumpToMessage: (messageId: string) => void
    scrollToLatest: () => void
  }) => void
}): JSX.Element {
  let scrollElement: HTMLDivElement | undefined
  let columnElement: HTMLDivElement | undefined

  const [handle, setHandle] = createSignal<VirtualizerHandle>()
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const toggleThread = (key: string) =>
    setExpanded((open) => {
      const next = new Set(open)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const memberSet = createMemo(() => (props.groupChat ? new Set(props.memberSlugs ?? []) : undefined))
  const lastItems = new Map<string, TimelineItem>()
  // Older rows paged in above the reader are held in place by virtua's `shift`, which keeps the
  // rows on screen where they were while the list grows at its start.
  let shifted = false
  let firstKey: string | undefined
  let itemsOwner: string | undefined
  const items = createMemo<TimelineItem[]>(() => {
    const next = keepUnchanged(
      lastItems,
      buildTimelineItems(props.messages, props.firstUnreadMessageId, {
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
      if (own || Date.now() - m.sentAt >= 10_000) continue
      fresh.add(m.id)
      const id = m.id
      setTimeout(() => fresh.delete(id), 600)
    }
    heard = now
  })

  const [replyTarget, setReplyTarget] = createSignal<string | null>(null)
  // A message still on its way has no id the room knows, so there is nothing yet to answer.
  const aimReplyAt = (messageId: string) => {
    if (messageId.startsWith("local:")) return
    setReplyTarget(messageId)
    props.onReplyTarget(messageId)
  }

  const activeReply = createMemo<string | null>(() =>
    props.replyTarget !== undefined ? props.replyTarget : replyTarget(),
  )

  const [scrollState, setScrollState] = createSignal<VirtualThreadState>()

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

  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const clock = setInterval(() => setNow(Date.now()), 60_000)
    onCleanup(() => clearInterval(clock))
  })

  // The day pill floats over the bubbles, so it shows only while the reader scrolls or points at the top edge.
  const [scrolling, setScrolling] = createSignal(false)
  const [nearTopEdge, setNearTopEdge] = createSignal(false)
  let scrollIdle: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(scrollIdle))
  const noteScrolling = () => {
    setScrolling(true)
    clearTimeout(scrollIdle)
    scrollIdle = setTimeout(() => setScrolling(false), DATE_CHIP_IDLE_MS)
  }
  const dateChipVisible = createMemo(() => topVisibleDay() !== undefined && (scrolling() || nearTopEdge()))

  const [landed, setLanded] = createSignal<string | undefined>()
  let landingGeneration = 0
  onCleanup(() => {
    landingGeneration += 1
  })

  const jumpToMessage = (messageId: string) => {
    const fold = items().find((item) => item.kind === "thread" && !item.expanded && item.messages.some((m) => m.id === messageId))
    if (fold) toggleThread(fold.key)
    const index = items().findIndex(
      (item) => item.kind === "message" && item.message.id === messageId,
    )
    if (index < 0) return
    stuck = false
    handle()?.scrollToIndex(index, { align: "start" })
    const generation = (landingGeneration += 1)
    setLanded(messageId)
    setTimeout(() => {
      if (landingGeneration === generation) setLanded(undefined)
    }, LANDING_MS)
    props.onJumpToMessage(messageId)
  }

  /** A quote goes to its original. One the window does not hold is loaded by its seq first. */
  const openReplyTarget = (messageId: string, seq?: number) => {
    const held = items().some((item) => item.kind === "message" && item.message.id === messageId) || items().some((item) => item.kind === "thread" && item.messages.some((m) => m.id === messageId))
    if (!held && seq !== undefined) return props.onJumpToSeq?.(messageId, seq)
    jumpToMessage(messageId)
  }

  onMount(() => {
    props.onJumpHandle?.({ jumpToMessage, scrollToLatest })
  })

  const days = createMemo(() => new Set(props.messages.map((m) => dayStartOf(m.sentAt))))
  const jumpToDay = (dayStart: number) => {
    const index = items().findIndex(
      (item) => item.kind === "message" && dayStartOf(item.message.sentAt) === dayStart,
    )
    if (index < 0) return
    stuck = false
    handle()?.scrollToIndex(index, { align: "start" })
    commitState(readState())
  }

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

  let restoredFor: string | undefined
  /** True once the saved position was actually applied. Only then may a scroll overwrite it. */
  let restoredOk = false
  let restoreGeneration = 0
  onCleanup(() => { restoreGeneration += 1 })

  const showsKey = () => {
    const first = props.messages[0]
    return props.scrollKey !== undefined && first !== undefined && first.threadId === props.scrollKey
  }

  const recordScroll = (state: VirtualThreadState) => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor !== key || !showsKey()) return
    const virtualizer = handle()
    if (!virtualizer) return
    // Before a restore has landed, the view is where this component put it, not where the reader
    // was. Saving that would erase the place they left, which is how a position was lost for good.
    if (!restoredOk && props.scrollBook.scroll(key)) return
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      props.scrollBook.saveScroll(key, null)
      return
    }
    const list = items()
    for (let i = clampIndex(state.rangeStart, list.length); i < list.length; i += 1) {
      const item = list[i]
      if (item.kind !== "message") continue
      // How far the row sits from the top of the viewport, measured on the row itself. The
      // virtualizer's own offsets start at the list, which is inset by the column's padding, so
      // subtracting them from `scrollTop` saved a row a few lines off.
      const row = columnElement?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(item.message.id)}"]`)
      const rect = row?.getBoundingClientRect()
      const viewport = scrollElement?.getBoundingClientRect()
      const offset = rect && viewport ? Math.round(rect.top - viewport.top) : Math.round(virtualizer.getItemOffset(i) - state.scrollOffset)
      props.scrollBook.saveScroll(key, { messageId: item.message.id, offset })
      return
    }
  }

  const restorePosition = (): boolean => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor === key || !showsKey()) return false
    // The book reads its positions from IndexedDB. Before it is ready every key looks unset, and
    // burning the attempt there would skip the restore for the whole visit.
    if (props.scrollBook.ready && !props.scrollBook.ready()) return false
    const saved = props.scrollBook.scroll(key)
    restoredFor = key
    if (!saved) {
      restoredOk = true
      return false
    }
    // A message the boot window does not hold cannot be scrolled to yet. The saved position stays
    // in the book, so a later visit that pages it in still finds it.
    const index = items().findIndex((item) => item.kind === "message" && item.message.id === saved.messageId)
    if (index < 0) return false
    const generation = ++restoreGeneration
    const current = () => generation === restoreGeneration && props.scrollKey === key
    let tries = 0
    stuck = false
    /**
     * `scrollToIndex` lands on an estimate for a row it has not measured yet, and the row it jumps
     * to is not in the DOM until the next frame. So the first pass only moves, and each later pass
     * reads the row's real position and corrects it: the reader lands on the message they left, not
     * a few lines off it.
     */
    const apply = (pass = 0) => {
      if (!current()) return
      const virtualizer = handle()
      const scroller = scrollElement
      if (!virtualizer || !scroller) {
        if ((tries += 1) < 10) requestAnimationFrame(() => apply(pass))
        return
      }
      if (pass === 0) {
        virtualizer.scrollToIndex(index, { align: "start" })
        // Rows above the target are estimated until they render, so the first landing is off. Two
        // frames let the measurement settle before the correction is read.
        requestAnimationFrame(() => requestAnimationFrame(() => apply(1)))
        return
      }
      const row = columnElement?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(saved.messageId)}"]`)
      if (!row) {
        if (pass < 3) requestAnimationFrame(() => apply(pass + 1))
        else finish()
        return
      }
      const drift = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - saved.offset
      // A drift past a screenful means the estimate was wrong, not that the row moved: jumping again
      // from the corrected offset converges in one step, where nudging scrollTop would crawl.
      if (Math.abs(drift) > 8 && pass < 3) {
        if (Math.abs(drift) > scroller.clientHeight) virtualizer.scrollToIndex(index, { align: "start", offset: drift })
        else scroller.scrollTop += drift
        requestAnimationFrame(() => apply(pass + 1))
        return
      }
      finish()
    }
    const finish = () => {
      if (!current()) return
      restoredOk = true
      commitState(readState())
    }
    apply()
    return true
  }

  const NEAR_TOP_ROWS = 8
  const commitState = (state: VirtualThreadState) => {
    setScrollState(state)
    recordScroll(state)
    if (!restoredOk && props.scrollKey && props.scrollBook?.scroll(props.scrollKey)) {
      props.onStateChange(state)
      return
    }
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      setPinnedCount(messageCount())
      props.onAtLatest?.()
    } else if (state.scrollSize > state.viewportSize) {
      // The reader is looking at older messages. The store must stop cutting the oldest rows out
      // from under them, which it only did when they paged, never when they simply scrolled up.
      props.onLeftLatest?.()
    }
    props.onStateChange(state)
  }

  const scrollToLatest = () => {
    const scroller = scrollElement
    if (!scroller) return
    stuck = true
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduced ? "auto" : "smooth" })
    if (reduced) return
    // Rows below the view are measured as they arrive, so the first target can fall short.
    scroller.addEventListener("scrollend", () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" }), { once: true })
  }

  // True while the reader is at the end. Content that grows under them (the typing line, a reply,
  // a row measured late) keeps them there. Only the reader's own scroll lets go of it.
  let stuck = true
  let readerScrolling = false
  // A drag that selects text: the browser scrolls the view itself, so nothing here may scroll it back.
  let dragging = false
  let dragFrom: { id: number; x: number; y: number } | undefined

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
   * Keeps a stuck reader on the last line. It runs from a ResizeObserver, which fires after layout
   * and before paint, so growth is followed in the same frame and never shows as a jump. Rows that
   * change size above a reader who scrolled up are virtua's to hold in place, not ours.
   */
  const followEnd = () => {
    const scroller = scrollElement
    if (!scroller || !stuck || dragging) return
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1) scroller.scrollTop = scroller.scrollHeight
  }

  /**
   * A thread that holds rows but shows none: the view sits where virtua has rendered nothing, and
   * only a scroll makes it look again. The reader's own small scroll fixed it, so this does the same.
   * Stuck at the end it jumps to the last row, and anywhere else it moves the view by one pixel.
   * Three tries a visit, so a view that stays empty cannot creep.
   */
  let blankTries = 0
  let blankKey: string | undefined
  const repairBlank = () => {
    const scroller = scrollElement
    const column = columnElement
    const virtualizer = handle()
    const count = items().length
    if (!scroller || !column || !virtualizer || count === 0 || scroller.clientHeight === 0) return
    if (blankKey !== props.scrollKey) {
      blankKey = props.scrollKey
      blankTries = 0
    }
    const view = scroller.getBoundingClientRect()
    for (const row of column.querySelectorAll<HTMLElement>('[data-component="chat-vrow"]')) {
      const box = row.getBoundingClientRect()
      if (box.bottom > view.top && box.top < view.bottom) {
        blankTries = 0
        return
      }
    }
    if (blankTries >= 3) return
    blankTries += 1
    if (stuck) virtualizer.scrollToIndex(count - 1, { align: "end" })
    else scroller.scrollTop += 1
  }

  onMount(() => {
    const scroller = scrollElement
    const column = columnElement
    if (!scroller || !column) return
    let blankCheck: ReturnType<typeof setTimeout> | undefined
    const checkBlank = () => {
      clearTimeout(blankCheck)
      blankCheck = setTimeout(repairBlank, 120)
    }
    onCleanup(() => clearTimeout(blankCheck))
    createEffect(on(() => props.scrollKey, checkBlank))
    const onScroll = () => {
      const state = readState()
      const atEnd = isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)
      if (atEnd && restoredOk) stuck = true
      else if (readerScrolling || dragging) stuck = false
      // A saved place whose message the window does not hold cannot be restored yet. Once the reader
      // scrolls, their own position is the truth, and saving it must be allowed again.
      if (readerScrolling && restoredFor === props.scrollKey) restoredOk = true
      commitState(state)
      checkBlank()
      if (!firstLoad && state.rangeStart < NEAR_TOP_ROWS && state.scrollSize > state.viewportSize) props.onNearTop?.()
    }
    const sizes = makeResizeObserver(() => {
      followEnd()
      commitState(readState())
      checkBlank()
    })
    sizes.observe(scroller)
    sizes.observe(column)
    createEventListener(() => scroller, "scroll", onScroll, { passive: true })
    let readerScrollEnd: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => clearTimeout(readerScrollEnd))
    const readerMoved = () => {
      restoreGeneration += 1
      readerScrolling = true
      // The day pill follows the reader, whichever way they scroll: keys and a drag move the view
      // without a wheel or a touch, and the pill is the only thing that says which day they are in.
      noteScrolling()
      clearTimeout(readerScrollEnd)
      readerScrollEnd = setTimeout(() => {
        readerScrolling = false
      }, READER_SCROLL_MS)
    }
    createEventListener(() => scroller, "wheel", readerMoved, { passive: true })
    createEventListener(() => scroller, "touchmove", readerMoved, { passive: true })
    createEventListener(() => scroller, "keydown", readerMoved)
    createEventListener(() => scroller, "pointerdown", (event: PointerEvent) => {
      if (event.target === scroller) readerMoved()
      dragging = event.pointerType === "mouse" && event.button === 0
      dragFrom = dragging ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined
    }, { passive: true })
    // Once a press turns into a drag, the scroller keeps the pointer, so the selection ends inside the thread
    // when the pointer crosses the header or the sidebar. A click is left alone: capture would retarget it.
    createEventListener(() => scroller, "pointermove", (event: PointerEvent) => {
      if (!dragFrom || event.pointerId !== dragFrom.id || Math.hypot(event.clientX - dragFrom.x, event.clientY - dragFrom.y) < 4) return
      scroller.setPointerCapture(dragFrom.id)
      dragFrom = undefined
    }, { passive: true })
    const endDrag = () => {
      dragging = false
      dragFrom = undefined
    }
    createEventListener(document, "pointerup", endDrag, { passive: true })
    createEventListener(document, "pointercancel", endDrag, { passive: true })
    createEventListener(() => scroller, "pointermove", (event: PointerEvent) => setNearTopEdge(event.clientY - scroller.getBoundingClientRect().top < DATE_CHIP_EDGE_PX), { passive: true })
    createEventListener(() => scroller, "pointerleave", () => setNearTopEdge(false), { passive: true })
    onCleanup(() => {
      sizes.unobserve(scroller)
      sizes.unobserve(column)
      props.scrollRef(undefined)
    })
  })

  let firstLoad = true
  let lastOwner: unknown
  createEffect(
    on(() => [items(), props.scrollKey, props.scrollBook?.ready?.()], () => {
      const owner: unknown = props.scrollKey ?? props.messages
      if (owner !== lastOwner) {
        lastOwner = owner
        firstLoad = true
        restoreGeneration += 1
        restoredFor = undefined
        restoredOk = false
        // `stuck` is a fact about the chat that was on screen. A new chat opens at its end.
        stuck = true
        readerScrolling = false
        setPinnedCount(messageCount())
      }
      const rows = items().length > 0
      if (restorePosition()) firstLoad = false
      else if (rows) {
        firstLoad = false
        followEnd()
      }
      commitState(readState())
    }),
  )

  const viewer = createImageDialog()
  provideThreadImages(viewer.open)

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
          quote={quoteOf(message, props.replyParent(message.replyToId), (slug) => props.botById(slug)?.name)}
          isRunStart={item.isRunStart}
          isRunEnd={item.isRunEnd}
          runKey={item.runKey}
          hasRunGapBefore={item.hasRunGapBefore}
          group={props.groupChat}
          class={fresh.has(message.id) ? (message.sender === "bot" ? "motion-reply-in" : "motion-bubble-in") : undefined}
          highlighted={landed() === message.id}
          replying={activeReply() === message.id}
          jumboClass={jumboEmojiClass(message.body)}
          onOpenReplyTarget={openReplyTarget}
          onReact={(emoji) => props.onReact?.(message.id, emoji)}
          onReply={() => aimReplyAt(message.id)}
          onMore={(anchor) => {
            const box = anchor.getBoundingClientRect()
            menu.openAt(message.id, box.left, box.bottom)
          }}
          onContextMenu={menu.onContextMenu}
          onOpenImages={(images, index, from) => {
            const clicked = images[index]
            // The arrows walk every picture of the chat, not only this message's.
            const chat = clicked ? chatImages(items().flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])), clicked) : { images, index }
            viewer.open(chat.images, chat.index, from)
          }}
        />
        {menu.view}
      </>
    )
  }

  const renderItem = (item: TimelineItem): JSX.Element => {
    if (item.kind === "day-divider") {
      const parts = dividerParts(item.firstSentAt, now())
      return <SystemRow label={parts.day} detail={parts.time} data-component="chat-divider" />
    }
    if (item.kind === "event" && item.message.event?.kind === "run_error") {
      return <ActivityEvent message={item.message} name={(slug) => props.botById(slug)?.name ?? agentDisplayName(slug, [])} latest={props.messages.at(-1)?.id === item.message.id} />
    }
    if (item.kind === "event" && item.message.event?.kind === "browser_control") {
      // A system line, like every other request in the transcript. The browser bar above the
      // composer carries the buttons, so the same two controls never appear twice.
      return <ActivityEvent message={item.message} name={(slug) => props.botById(slug)?.name ?? agentDisplayName(slug, [])} />
    }
    if (item.kind === "event") {
      return <ActivityEvent message={item.message} name={(slug) => props.botById(slug)?.name ?? agentDisplayName(slug, [])} />
    }
    if (item.kind === "thread") {
      return (
        <AgentThread
          names={item.slugs.map((slug) => props.botById(slug)?.name ?? agentDisplayName(slug, []))}
          count={item.messages.length}
          expanded={item.expanded}
          onToggle={() => toggleThread(item.key)}
        />
      )
    }
    if (item.kind === "unread-divider") {
      return (
        <SystemRow label="New messages" tone="accent" data-component="chat-unread-rule" />
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

            <Show when={props.waitingNames.length > 0}>
              <div
                class={cn(
                  "mx-auto flex w-full max-w-(--chat-content-max-width) px-4 pb-(--row-gap)",
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
