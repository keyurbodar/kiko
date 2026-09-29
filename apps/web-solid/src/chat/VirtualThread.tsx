import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { Virtualizer } from "virtua/solid"
import type { VirtualizerHandle } from "virtua/solid"
import type { ChatMessage, RosterBot } from "../lib/types"
import { buildTimelineItems } from "./lib/grouping"
import { formatDayLabel } from "./lib/dayLabel"
import { DRIFT_EPSILON, driftCompensation, rowReserveStyle } from "./lib/heights"
import { WaitingRow } from "./ui/WaitingRow"
import { Row } from "./ui/Row"
import "./chat.css"

export interface VirtualThreadState {
  readonly scrollOffset: number
  readonly scrollSize: number
  readonly viewportSize: number
  readonly rangeStart: number
  readonly rangeEnd: number
}

const BOTTOM_EPSILON = 2
const BUFFER_SIZE = 600
const ROW_SELECTOR = '[data-component="chat-vrow"]'

type DriftAnchor = { readonly element: HTMLElement; readonly top: number }

const clampIndex = (index: number, count: number): number =>
  Math.min(Math.max(index, 0), Math.max(count - 1, 0))

export function VirtualThread(props: {
  messages: readonly ChatMessage[]
  botById: (botId: string | undefined) => RosterBot | undefined
  replyParent: (messageId: string | undefined) => ChatMessage | undefined
  onToggleReaction: (messageId: string, emoji: string) => void
  scrollRef: (element: HTMLDivElement | undefined) => void
  onStateChange: (state: VirtualThreadState) => void
  waitingNames: readonly string[]
}) {
  let scrollElement: HTMLDivElement | undefined
  let columnElement: HTMLDivElement | undefined

  const [handle, setHandle] = createSignal<VirtualizerHandle>()
  const items = createMemo(() => buildTimelineItems(props.messages))

  const jumpToMessage = (messageId: string) => {
    const index = items().findIndex(
      (item) => item.kind === "message" && item.message.id === messageId,
    )
    if (index < 0) return
    handle()?.scrollToIndex(index, { align: "start" })
  }
  const now = new Date().getTime()

  let anchor: DriftAnchor | undefined

  const readState = (): VirtualThreadState => {
    const virtualizer = handle()
    const count = items().length
    const scrollOffset = virtualizer?.scrollOffset ?? scrollElement?.scrollTop ?? 0
    const viewportSize = virtualizer?.viewportSize ?? scrollElement?.clientHeight ?? 0
    const scrollSize = virtualizer?.scrollSize ?? scrollElement?.scrollHeight ?? 0
    const first = count === 0 ? 0 : (virtualizer?.findItemIndex(scrollOffset) ?? 0)
    const last = count === 0 ? 0 : (virtualizer?.findItemIndex(scrollOffset + viewportSize) ?? 0)
    return {
      scrollOffset,
      scrollSize,
      viewportSize,
      rangeStart: clampIndex(first, count),
      rangeEnd: clampIndex(last, count),
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
    const held = anchor?.element.isConnected === true ? anchor : undefined
    if (!held) {
      seedAnchor()
      props.onStateChange(state)
      return
    }
    const atBottom = state.scrollOffset + state.viewportSize >= state.scrollSize - BOTTOM_EPSILON
    const drift =
      held.element.getBoundingClientRect().top -
      columnElement.getBoundingClientRect().top -
      held.top
    const compensation = driftCompensation(drift, atBottom)
    if (compensation === 0) {
      seedAnchor()
      props.onStateChange(state)
      return
    }
    const virtualizer = handle()
    if (virtualizer) virtualizer.scrollBy(compensation)
    else scrollElement.scrollBy(0, compensation)
    requestAnimationFrame(seedAnchor)
    props.onStateChange(readState())
  }

  onMount(() => {
    if (!scrollElement || !columnElement) return
    const onScroll = () => {
      seedAnchor()
      props.onStateChange(readState())
    }
    const onViewportResize = () => {
      seedAnchor()
      props.onStateChange(readState())
    }
    const viewportObserver = new ResizeObserver(onViewportResize)
    const contentObserver = new ResizeObserver(cancelDrift)
    viewportObserver.observe(scrollElement)
    contentObserver.observe(columnElement)
    scrollElement.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => {
      viewportObserver.disconnect()
      contentObserver.disconnect()
      scrollElement?.removeEventListener("scroll", onScroll)
    })
  })

  onCleanup(() => {
    props.scrollRef(undefined)
  })

  createEffect(
    on(items, () => {
      seedAnchor()
      props.onStateChange(readState())
    }),
  )

  return (
    <div
      class="chat-scroll"
      data-component="chat-scroll"
      data-virtual-scroll=""
      ref={(element) => {
        scrollElement = element
        props.scrollRef(element)
      }}
    >
      <div
        class="chat-column"
        data-component="chat-column"
        data-virtual-column=""
        ref={(element) => {
          columnElement = element
        }}
      >
        <Show
          when={items().length > 0}
          fallback={
            <div class="chat-empty" data-component="chat-empty">
              <span class="chat-empty__title">Nothing here yet</span>
              <span class="chat-empty__hint">Send the first message to start the thread.</span>
            </div>
          }
        >
          <Virtualizer
            data={items()}
            scrollRef={scrollElement}
            bufferSize={BUFFER_SIZE}
            ref={setHandle}
          >
            {(item) => (
              <div data-component="chat-vrow" style={rowReserveStyle(item)}>
                {item.kind === "day-divider" ? (
                  <div class="chat-divider" data-component="chat-divider">
                    <span class="chat-divider__pill">{formatDayLabel(item.dayStart, now)}</span>
                  </div>
                ) : (
                  <Row
                    item={item}
                    bot={props.botById(item.message.botId)}
                    onJumpToReply={jumpToMessage}
                    parent={props.replyParent(item.message.replyToId)}
                    onToggleReaction={props.onToggleReaction}
                  />
                )}
              </div>
            )}
          </Virtualizer>
        </Show>
        <WaitingRow names={props.waitingNames} />
      </div>
    </div>
  )
}
