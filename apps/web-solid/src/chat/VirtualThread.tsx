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
  untrack,
  type JSX,
} from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import type { ChatMessage, RosterBot } from "../lib/types"
import { buildTimelineItems, dayStartOf, keepUnchanged, type TimelineItem } from "./lib/grouping"
import { AT_BOTTOM_THRESHOLD_PX, isAtBottom } from "./lib/drift"
import { createGlide } from "./lib/glide"
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
import { NewAbovePill, ScrollDown, type NewAbove } from "./ui/ScrollFaces"
import { createImageDialog, provideThreadImages } from "./ui/image-dialog"
import type { DraftBook } from "../composer/draft-book"

export interface VirtualThreadState {
  readonly scrollOffset: number
  readonly scrollSize: number
  readonly viewportSize: number
  readonly rangeStart: number
  readonly rangeEnd: number
}

const BUFFER_SIZE = 600

const LANDING_MS = 1200

const DATE_CHIP_IDLE_MS = 800

const READER_SCROLL_MS = 250

const STAGE_CLASS = "relative flex min-h-0 flex-1 flex-col"

const SCROLLER_CLASS =
  "relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none]"

const COLUMN_CLASS =
  "mx-auto flex min-h-full w-full max-w-(--chat-content-max-width) self-start flex-col pt-[calc(3rem+var(--top-bar-h,0px))] pb-12"

const clampIndex = (index: number, count: number): number => Math.min(Math.max(index, 0), Math.max(count - 1, 0))

export function VirtualThread(props: {
  messages: readonly ChatMessage[]
  botById: (botId: string | undefined) => RosterBot | undefined
  replyParent: (messageId: string | undefined) => ChatMessage | undefined
  firstUnreadMessageId: string | null
  onJumpToMessage: (messageId: string) => void
  onReplyTarget: (messageId: string) => void
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
  scrollKey?: string
  scrollBook?: Pick<DraftBook, "scroll" | "saveScroll"> & Partial<Pick<DraftBook, "ready">>
  onJumpHandle?: (handle: { jumpToMessage: (messageId: string) => void; scrollToLatest: () => void }) => void
  onToLatest?: () => void
  detached?: boolean
}): JSX.Element {
  let scrollElement: HTMLDivElement | undefined
  let columnElement: HTMLDivElement | undefined
  const glide = createGlide(() => scrollElement)
  onCleanup(glide.stop)

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
  let shifted = false
  let firstKey: string | undefined
  let itemsOwner: string | undefined
  let restoreMisses = 0
  const items = createMemo<TimelineItem[]>(() => {
    const next = keepUnchanged(
      lastItems,
      buildTimelineItems(props.messages, props.firstUnreadMessageId, {
        members: memberSet(),
        expanded: expanded(),
      }),
    )
    const owner = props.scrollKey
    if (owner !== itemsOwner) restoreMisses = 0
    shifted = owner === itemsOwner && firstKey !== undefined && next.length > 0 && next[0].key !== firstKey
    itemsOwner = owner
    firstKey = next[0]?.key
    return next
  })
  const isShifted = () => shifted

  let heard = new Set<string>()
  const [fresh, setFresh] = createSignal<ReadonlySet<string>>(new Set())
  const markFresh = (id: string, on: boolean) =>
    setFresh((now) => {
      if (now.has(id) === on) return now
      const next = new Set(now)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
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
      setFresh(new Set<string>())
      return
    }
    for (const m of messages) {
      if (heard.has(m.id)) continue
      const own = m.sender === "user" && !m.id.startsWith("local:")
      if (own || Date.now() - m.sentAt >= 10_000) continue
      const id = m.clientId ?? m.id
      markFresh(id, true)
      setTimeout(() => markFresh(id, false), 700)
    }
    heard = now
  })

  const [replyTarget, setReplyTarget] = createSignal<string | null>(null)
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

  const [scrolling, setScrolling] = createSignal(false)
  let scrollIdle: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(scrollIdle))
  const noteScrolling = () => {
    setScrolling(true)
    clearTimeout(scrollIdle)
    scrollIdle = setTimeout(() => setScrolling(false), DATE_CHIP_IDLE_MS)
  }
  const dateChipVisible = createMemo(() => topVisibleDay() !== undefined && scrolling())

  const [landed, setLanded] = createSignal<string | undefined>()
  let landingGeneration = 0
  onCleanup(() => {
    landingGeneration += 1
  })

  let stuck = true
  let readerScrolling = false
  let dragging = false
  let dragFrom: { id: number; x: number; y: number } | undefined

  const topInset = () => (scrollElement ? parseFloat(getComputedStyle(scrollElement).scrollPaddingTop) || 0 : 0)

  const jumpToMessage = (messageId: string) => {
    const fold = items().find(
      (item) => item.kind === "thread" && !item.expanded && item.messages.some((m) => m.id === messageId),
    )
    if (fold) toggleThread(fold.key)
    const index = items().findIndex((item) => item.kind === "message" && item.message.id === messageId)
    if (index < 0) return
    stuck = false
    handle()?.scrollToIndex(index, { align: "start", offset: -topInset() })
    const generation = (landingGeneration += 1)
    setLanded(messageId)
    setTimeout(() => {
      if (landingGeneration === generation) setLanded(undefined)
    }, LANDING_MS)
    props.onJumpToMessage(messageId)
  }

  const openReplyTarget = (messageId: string, seq?: number) => {
    const held =
      items().some((item) => item.kind === "message" && item.message.id === messageId) ||
      items().some((item) => item.kind === "thread" && item.messages.some((m) => m.id === messageId))
    if (!held && seq !== undefined) return props.onJumpToSeq?.(messageId, seq)
    jumpToMessage(messageId)
  }

  onMount(() => {
    props.onJumpHandle?.({ jumpToMessage, scrollToLatest })
  })

  const days = createMemo(() => new Set(props.messages.map((m) => dayStartOf(m.sentAt))))
  const jumpToDay = (dayStart: number) => {
    const index = items().findIndex((item) => item.kind === "message" && dayStartOf(item.message.sentAt) === dayStart)
    if (index < 0) return
    stuck = false
    handle()?.scrollToIndex(index, { align: "start", offset: -topInset() })
    commitState(readState())
  }

  const isAtLatest = () => {
    const state = scrollState()
    return state ? isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX) : true
  }

  let restoredFor: string | undefined
  let restoredOk = false
  let restoreGeneration = 0
  onCleanup(() => {
    restoreGeneration += 1
  })

  const farFromLatest = () => {
    const state = scrollState()
    return !!state && state.scrollSize - state.scrollOffset - state.viewportSize > state.viewportSize
  }

  const [replyBelow, setReplyBelow] = createSignal(false)
  let newestBot: string | undefined
  let newestKey: string | undefined
  createComputed(() => {
    const newest = props.messages.findLast((m) => m.sender === "bot" && !m.event)?.id
    const key = props.scrollKey
    const moved = key === newestKey && newestBot !== undefined && newest !== undefined && newest !== newestBot
    newestKey = key
    newestBot = newest
    if (moved && !untrack(isAtLatest)) setReplyBelow(true)
  })
  createEffect(
    on(
      () => props.scrollKey,
      () => setReplyBelow(false),
    ),
  )
  createEffect(() => {
    if (isAtLatest()) setReplyBelow(false)
  })

  const unreadAt = createMemo(() => items().findIndex((item) => item.kind === "unread-divider"))
  const unreadSenders = createMemo(() => {
    const first = props.firstUnreadMessageId
    const at = first ? props.messages.findIndex((m) => m.id === first) : -1
    if (at < 0) return { count: 0, slugs: [] as string[] }
    const unread = props.messages.slice(at).filter((m) => m.sender === "bot" && !m.event)
    return { count: unread.length, slugs: [...new Set(unread.flatMap((m) => (m.botId ? [m.botId] : [])))] }
  })
  const [unreadReached, setUnreadReached] = createSignal(false)
  createEffect(
    on(
      () => [props.scrollKey, props.firstUnreadMessageId],
      () => setUnreadReached(false),
    ),
  )
  createEffect(() => {
    const state = scrollState()
    const at = unreadAt()
    if (!state || at < 0 || untrack(unreadReached) || !restoredOk || glide.active()) return
    if (document.visibilityState === "hidden") return
    if (at >= state.rangeStart && at <= state.rangeEnd) setUnreadReached(true)
  })

  const showsKey = () => {
    const first = props.messages[0]
    return props.scrollKey !== undefined && first !== undefined && first.threadId === props.scrollKey
  }

  const recordScroll = (state: VirtualThreadState) => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor !== key || !showsKey()) return
    const virtualizer = handle()
    if (!virtualizer) return
    if (!restoredOk && props.scrollBook.scroll(key)) return
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)) {
      props.scrollBook.saveScroll(key, null)
      return
    }
    const list = items()
    for (let i = clampIndex(state.rangeStart, list.length); i < list.length; i += 1) {
      const item = list[i]
      if (item.kind !== "message") continue
      const row = columnElement?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(item.message.id)}"]`)
      const rect = row?.getBoundingClientRect()
      const viewport = scrollElement?.getBoundingClientRect()
      const offset =
        rect && viewport
          ? Math.round(rect.top - viewport.top)
          : Math.round(virtualizer.getItemOffset(i) - state.scrollOffset)
      props.scrollBook.saveScroll(key, { messageId: item.message.id, offset })
      return
    }
  }

  const restorePosition = (): boolean => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor === key || !showsKey()) return false
    if (props.scrollBook.ready && !props.scrollBook.ready()) return false
    if (props.scrollKey !== key) return false
    const saved = props.scrollBook.scroll(key)
    if (!saved) {
      restoredFor = key
      restoredOk = true
      return false
    }
    const index = items().findIndex(
      (item) =>
        (item.kind === "message" && item.message.id === saved.messageId) ||
        (item.kind === "thread" && item.messages.some((m) => m.id === saved.messageId)),
    )
    if (index < 0) {
      restoreMisses += 1
      if (restoreMisses < 3) return false
      props.scrollBook.saveScroll(key, null)
      restoredFor = key
      restoredOk = true
      return false
    }
    restoreMisses = 0
    restoredFor = key
    const generation = ++restoreGeneration
    const current = () => generation === restoreGeneration && props.scrollKey === key
    let tries = 0
    stuck = false
    function finish() {
      if (!current()) return
      restoredOk = true
      commitState(readState())
    }
    const apply = (pass = 0) => {
      if (!current()) return
      const virtualizer = handle()
      const scroller = scrollElement
      if (!virtualizer || !scroller) {
        if ((tries += 1) < 10) requestAnimationFrame(() => apply(pass))
        else finish()
        return
      }
      if (pass === 0) {
        virtualizer.scrollToIndex(index, { align: "start" })
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
      if (Math.abs(drift) > 8 && pass < 3) {
        if (Math.abs(drift) > scroller.clientHeight) virtualizer.scrollToIndex(index, { align: "start", offset: drift })
        else scroller.scrollTop += drift
        requestAnimationFrame(() => apply(pass + 1))
        return
      }
      finish()
    }
    apply()
    return true
  }

  const NEAR_TOP_ROWS = 8

  function readState(): VirtualThreadState {
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

  function commitState(state: VirtualThreadState) {
    setScrollState(state)
    recordScroll(state)
    if (!restoredOk && props.scrollKey && props.scrollBook?.scroll(props.scrollKey)) {
      props.onStateChange(state)
      return
    }
    if (isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX))
      props.onAtLatest?.()
    props.onStateChange(state)
  }

  function scrollToLatest() {
    stuck = true
    glide.toEnd()
  }

  const followEnd = () => {
    const scroller = scrollElement
    if (!scroller || !stuck || dragging || glide.active()) return
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1)
      scroller.scrollTop = scroller.scrollHeight
  }

  let firstLoad = true
  let lastOwner: unknown
  let lastKey: string | undefined
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
    if (blankTries === 3) stuck = true
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
    createEffect(on(items, checkBlank))
    const onScroll = () => {
      const state = readState()
      const atEnd = isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)
      if (atEnd && (restoredOk || !props.scrollBook?.scroll(props.scrollKey ?? ""))) stuck = true
      else if (readerScrolling || dragging) stuck = false
      commitState(state)
      checkBlank()
      if (!firstLoad && state.rangeStart < NEAR_TOP_ROWS && state.scrollSize > state.viewportSize) props.onNearTop?.()
    }
    let resyncFrame = 0
    onCleanup(() => cancelAnimationFrame(resyncFrame))
    const resync = () => {
      cancelAnimationFrame(resyncFrame)
      resyncFrame = requestAnimationFrame(() => {
        const virtualizer = handle()
        if (!virtualizer || scroller.scrollTop !== 0 || glide.active()) return
        if (virtualizer.scrollOffset > scroller.clientHeight) scroller.scrollTop = virtualizer.scrollOffset
      })
    }
    createEventListener(() => scroller, "pointerenter", resync, { passive: true })
    createEventListener(() => scroller, "focusin", resync)
    createEventListener(document, "visibilitychange", resync)
    createEventListener(window, "focus", resync)
    const sizes = makeResizeObserver(() => {
      resync()
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
      resync()
      restoreGeneration += 1
      glide.stop()
      readerScrolling = true
      noteScrolling()
      clearTimeout(readerScrollEnd)
      readerScrollEnd = setTimeout(() => {
        readerScrolling = false
      }, READER_SCROLL_MS)
    }
    createEventListener(() => scroller, "wheel", readerMoved, { passive: true })
    createEventListener(() => scroller, "touchmove", readerMoved, { passive: true })
    createEventListener(() => scroller, "keydown", readerMoved)
    createEventListener(
      () => scroller,
      "pointerdown",
      (event: PointerEvent) => {
        if (event.target === scroller) readerMoved()
        dragging = event.pointerType === "mouse" && event.button === 0
        dragFrom = dragging ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined
      },
      { passive: true },
    )
    createEventListener(
      () => scroller,
      "pointermove",
      (event: PointerEvent) => {
        if (
          !dragFrom ||
          event.pointerId !== dragFrom.id ||
          Math.hypot(event.clientX - dragFrom.x, event.clientY - dragFrom.y) < 4
        )
          return
        scroller.setPointerCapture(dragFrom.id)
        dragFrom = undefined
      },
      { passive: true },
    )
    const endDrag = () => {
      dragging = false
      dragFrom = undefined
    }
    createEventListener(document, "pointerup", endDrag, { passive: true })
    createEventListener(document, "pointercancel", endDrag, { passive: true })
    createEventListener(
      () => column,
      "click",
      (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest("[data-disclosure]")) stuck = false
      },
      { capture: true },
    )
    onCleanup(() => {
      sizes.unobserve(scroller)
      sizes.unobserve(column)
      props.scrollRef(undefined)
    })
  })

  createEffect(
    on(
      () => [items(), props.scrollKey, props.scrollBook?.ready?.()],
      () => {
        const owner: unknown = props.scrollKey ?? props.messages
        if (owner !== lastOwner) {
          lastOwner = owner
          firstLoad = true
          restoreGeneration += 1
          restoredFor = undefined
          restoredOk = false
          stuck = true
          readerScrolling = false
        }
        const rows = items().length > 0
        const newest = items().at(-1)?.key
        const arrived = !firstLoad && newest !== lastKey
        lastKey = newest
        if (restorePosition()) firstLoad = false
        else if (rows) {
          firstLoad = false
          if (arrived && stuck && !dragging) glide.toEnd()
          else followEnd()
        }
        commitState(readState())
      },
    ),
  )

  const viewer = createImageDialog()
  provideThreadImages(viewer.open)

  const renderMessage = (item: TimelineItem & { kind: "message" }): JSX.Element => {
    const message = () => item.message
    const menu = createMessageMenu({
      messageFor: (id) => {
        for (const entry of items()) {
          if (entry.kind === "message" && entry.message.id === id) return entry.message
        }
        return message()
      },
      side: message().sender,
      onReply: () => aimReplyAt(menu.targetId() ?? message().id),
      get onEdit() {
        return message().sender === "user" &&
          !message().id.startsWith("local:") &&
          message().body.trim() &&
          props.onEdit
          ? () => props.onEdit!(menu.targetId() ?? message().id)
          : undefined
      },
      get onDelete() {
        return message().sender === "user" && !message().id.startsWith("local:") && props.onDelete
          ? () => props.onDelete!(menu.targetId() ?? message().id)
          : undefined
      },
      onReact: (emoji) => props.onReact?.(menu.targetId() ?? message().id, emoji),
    })
    const bot = createMemo(() => props.botById(message().botId))
    const parent = createMemo(() => props.replyParent(message().replyToId))
    const quote = createMemo(() => quoteOf(message(), parent(), (slug) => props.botById(slug)?.name))
    return (
      <>
        <MessageRow
          message={message()}
          bot={bot()}
          quote={quote()}
          isRunStart={item.isRunStart}
          isRunEnd={item.isRunEnd}
          runKey={item.runKey}
          hasRunGapBefore={item.hasRunGapBefore}
          group={props.groupChat}
          class={
            fresh().has(message().clientId ?? message().id)
              ? message().sender === "bot"
                ? "motion-reply-in"
                : "motion-bubble-in"
              : undefined
          }
          highlighted={landed() === message().id}
          replying={activeReply() === message().id}
          jumboClass={jumboEmojiClass(message().body)}
          onOpenReplyTarget={openReplyTarget}
          onReact={(emoji) => props.onReact?.(message().id, emoji)}
          onReply={() => aimReplyAt(message().id)}
          onMore={(anchor) => {
            const box = anchor.getBoundingClientRect()
            menu.openAt(message().id, box.left, box.bottom)
          }}
          onContextMenu={menu.onContextMenu}
          onOpenImages={viewer.open}
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
      return (
        <ActivityEvent
          message={item.message}
          name={(slug) => props.botById(slug)?.name ?? agentDisplayName(slug, [])}
          latest={props.messages.at(-1)?.id === item.message.id}
          group={props.groupChat}
        />
      )
    }
    if (item.kind === "event") {
      return (
        <ActivityEvent
          message={item.message}
          name={(slug) => props.botById(slug)?.name ?? agentDisplayName(slug, [])}
        />
      )
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
      const count = unreadSenders().count
      return (
        <SystemRow
          label={count > 0 ? `${count} new` : "New messages"}
          tone="accent"
          stitch
          data-component="chat-unread-rule"
        />
      )
    }
    return untrack(() => renderMessage(item))
  }

  const hasMessages = () => items().length > 0

  const newAbove = createMemo<NewAbove | null>(() => {
    const at = unreadAt()
    const state = scrollState()
    if (at < 0 || unreadReached() || dateChipVisible() || !state || at >= state.rangeStart) return null
    const senders = unreadSenders()
    return senders.count > 0 ? senders : null
  })
  const jumpToUnread = () => {
    const first = props.firstUnreadMessageId
    if (!first) return
    setUnreadReached(true)
    jumpToMessage(first)
  }

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
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Messages"
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
                {(item) => <div data-component="chat-vrow">{renderItem(item)}</div>}
              </Virtualizer>

              <Show when={props.waitingNames.length > 0}>
                <div
                  class={cn(
                    "mx-auto flex w-full max-w-(--chat-content-max-width) px-4 pb-(--row-gap)",
                    props.messages.at(-1)?.sender === "bot" ? "pt-(--row-gap)" : "pt-(--run-gap)",
                  )}
                  data-component="chat-typing-row"
                >
                  <TypingIndicator
                    typists={[...props.waitingNames]}
                    seeds={props.waitingSlugs}
                    doings={props.waitingDoings}
                    group={props.groupChat}
                  />
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
      <ScrollFades showTop={(scrollState()?.scrollOffset ?? 0) > 0} showBottom={!isAtLatest()} />
      <NewAbovePill above={newAbove()} onClick={jumpToUnread} />
      <ScrollDown
        shown={farFromLatest() || !!props.detached}
        working={props.waitingSlugs ?? []}
        landed={replyBelow()}
        onClick={() => (props.onToLatest ? props.onToLatest() : scrollToLatest())}
      />

      {viewer.view}
    </div>
  )
}
