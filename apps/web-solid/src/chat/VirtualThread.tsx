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
import { AT_BOTTOM_THRESHOLD_PX, DRIFT_EPSILON, driftCompensation, isAtBottom } from "./lib/drift"
import { dividerLabel, dividerParts } from "./lib/time-label"
import { jumboEmojiClass, quoteOf } from "./lib/reply"
import { MessageRow } from "./ui/MessageRow"
import { DateChip } from "./ui/DateChip"
import { SystemMessage } from "./SystemMessage"
import { ActivityEvent } from "./ui/ActivityEvent"
import { EventDivider } from "./ui/EventDivider"
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

const RunErrorRow = lazy(() => import("./ui/RunErrorRow"))

export interface VirtualThreadState {
  readonly scrollOffset: number
  readonly scrollSize: number
  readonly viewportSize: number
  readonly rangeStart: number
  readonly rangeEnd: number
}

const BUFFER_SIZE = 600

const BOTTOM_EPSILON = 2

const PIN_SETTLE_MS = 400

const LANDING_MS = 1200

const DATE_CHIP_IDLE_MS = 1200

const READER_SCROLL_MS = 250

const DATE_CHIP_EDGE_PX = 56


type DriftAnchor = { readonly element: HTMLElement; readonly top: number }

const STAGE_CLASS = "relative flex min-h-0 flex-1 flex-col"

const SCROLLER_CLASS =
  "relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain"

const COLUMN_CLASS =
  "mx-auto flex min-h-full w-full max-w-(--chat-content-max-width) self-start flex-col pt-12 pb-12"

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
  scrollKey?: string
  scrollBook?: Pick<DraftBook, "scroll" | "saveScroll">
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

  let pinRun = 0
  const jumpToMessage = (messageId: string) => {
    pinRun += 1
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
    seedAnchor()
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

  const showsKey = () => {
    const first = props.messages[0]
    return props.scrollKey !== undefined && first !== undefined && first.threadId === props.scrollKey
  }

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

  const restorePosition = (): boolean => {
    const key = props.scrollKey
    if (!key || !props.scrollBook || restoredFor === key || !showsKey()) return false
    restoredFor = key
    const saved = props.scrollBook.scroll(key)
    if (!saved) return false
    const index = items().findIndex((item) => item.kind === "message" && item.message.id === saved.messageId)
    if (index < 0) return false
    let tries = 0
    stuck = false
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

  const scrollToLatest = () => {
    const scroller = scrollElement
    if (!scroller) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduced ? "auto" : "smooth" })
    if (reduced) return
    // Rows below the view are measured as they arrive, so the first target can fall short.
    scroller.addEventListener("scrollend", () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" }), { once: true })
  }

  let anchor: DriftAnchor | undefined
  // True while the reader is at the end. Content that grows under them (the typing line, a reply) keeps them there.
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
    for (const node of rows) {
      const rect = node.getBoundingClientRect()
      if (rect.bottom > base + top) {
        anchor = { element: node, top: rect.top - base }
        return
      }
    }
  }

  const cancelDrift = () => {
    if (!scrollElement || !columnElement) return
    const state = readState()
    if (dragging) {
      stuck = false
      seedAnchor()
      commitState(state)
      return
    }
    const held = anchor?.element.isConnected === true ? anchor : undefined
    if (!held) {
      seedAnchor()
      commitState(state)
      return
    }
    const atBottom =
      state.scrollOffset + state.viewportSize >= state.scrollSize - BOTTOM_EPSILON
    if (stuck && !atBottom) {
      scrollElement.scrollTop = scrollElement.scrollHeight
      seedAnchor()
      commitState(readState())
      return
    }
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
      const atEnd = isAtBottom(state.scrollOffset, state.scrollSize, state.viewportSize, AT_BOTTOM_THRESHOLD_PX)
      // Rows measured after they render also move the offset. Only a reader's own scroll lets go of the end.
      if (atEnd) stuck = true
      else if (readerScrolling) stuck = false
      commitState(state)
      if (!firstLoad && state.rangeStart < NEAR_TOP_ROWS && state.scrollSize > state.viewportSize) props.onNearTop?.()
    }
    const onViewportResize = () => {
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
    let readerScrollEnd: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => clearTimeout(readerScrollEnd))
    const readerMoved = () => {
      readerScrolling = true
      clearTimeout(readerScrollEnd)
      readerScrollEnd = setTimeout(() => {
        readerScrolling = false
      }, READER_SCROLL_MS)
    }
    const onReader = () => {
      noteScrolling()
      readerMoved()
    }
    createEventListener(() => scroller, "wheel", onReader, { passive: true })
    createEventListener(() => scroller, "touchmove", onReader, { passive: true })
    createEventListener(() => scroller, "keydown", readerMoved)
    createEventListener(() => scroller, "pointerdown", (event: PointerEvent) => {
      if (event.target === scroller) onReader()
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
      if (!dragging) return
      dragging = false
      dragFrom = undefined
      seedAnchor()
    }
    createEventListener(document, "pointerup", endDrag, { passive: true })
    createEventListener(document, "pointercancel", endDrag, { passive: true })
    createEventListener(() => scroller, "pointermove", (event: PointerEvent) => setNearTopEdge(event.clientY - scroller.getBoundingClientRect().top < DATE_CHIP_EDGE_PX), { passive: true })
    createEventListener(() => scroller, "pointerleave", () => setNearTopEdge(false), { passive: true })
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

  let firstLoad = true
  let lastOwner: unknown
  createEffect(
    on(items, () => {
      const owner: unknown = props.scrollKey ?? props.messages
      if (owner !== lastOwner) {
        lastOwner = owner
        firstLoad = true
        anchor = undefined
        setPinnedCount(messageCount())
        if (scrollElement) scrollElement.scrollTop = scrollElement.scrollHeight
      }
      const restoring = restorePosition()
      const wasAtLatest = firstLoad || stuck || isAtLatest()
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
      return (
        <SystemMessage variant="divider" label={dividerLabel(item.firstSentAt, now())} data-component="chat-divider">
          {dividerParts(item.firstSentAt, now()).time}
        </SystemMessage>
      )
    }
    if (item.kind === "event" && item.message.event?.kind === "run_error") {
      const failed = item.message.event as Extract<SystemEvent, { kind: "run_error" }>
      return (
        <Suspense fallback={<ActivityEvent message={item.message} name={(slug) => props.botById(slug)?.name ?? agentDisplayName(slug, [])} />}>
          <RunErrorRow message={item.message} slug={failed.slug} actions={failed.actions} detail={failed.detail} latest={props.messages.at(-1)?.id === item.message.id} />
        </Suspense>
      )
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
        <EventDivider class="text-ring [&>.line]:bg-ring/45" data-component="chat-unread-rule">
          New messages
        </EventDivider>
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
