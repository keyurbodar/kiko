import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  useContext,
} from "solid-js";
import { createAutoScroll } from "@kiko/ui/hooks";
import type { ChatMessage, RosterBot } from "../lib/types";
import {
  AT_BOTTOM_THRESHOLD_PX,
  SCROLL_OWNERSHIP,
  computeAnchor,
  isAtBottom,
  shouldSettleForVirtualizedBottom,
  type AnchorState,
  type MessageDelta,
  type ThreadAnchoring,
} from "./lib/anchoring";
import { buildTimelineItems } from "./lib/grouping";
import { formatDayLabel } from "./lib/dayLabel";
import { Row } from "./ui/Row";
import "./chat.css";

const ThreadAnchoringContext = createContext<ThreadAnchoring>();

export function useThreadAnchoring(): ThreadAnchoring {
  const anchoring = useContext(ThreadAnchoringContext);
  if (!anchoring) throw new Error("useThreadAnchoring called outside a Thread");
  return anchoring;
}

const measureAnchor = (el: HTMLElement): AnchorState =>
  computeAnchor(
    { top: el.getBoundingClientRect().top },
    Array.from(
      el.querySelectorAll<HTMLElement>("[data-message-id]"),
      (row) => ({
        messageId: row.dataset.messageId,
        top: row.getBoundingClientRect().top,
        bottom: row.getBoundingClientRect().bottom,
      }),
    ),
  );

type MessageCensus = {
  readonly firstId: string;
  readonly lastId: string;
  readonly count: number;
};

const censusKey = (messages: readonly ChatMessage[]): string => {
  const first = messages[0];
  const last = messages[messages.length - 1];
  if (!first || !last) return "";
  return `${first.id}|${last.id}|${messages.length}`;
};

const readCensus = (key: string | undefined): MessageCensus | undefined => {
  if (!key) return undefined;
  const [firstId, lastId, count] = key.split("|");
  if (!firstId || !lastId || !count) return undefined;
  return { firstId, lastId, count: Number(count) };
};

const deltaBetween = (
  previous: MessageCensus | undefined,
  next: MessageCensus | undefined,
): { delta: MessageDelta; arrived: number } => {
  if (!previous || !next) return { delta: "replace", arrived: 0 };
  if (next.count === previous.count && next.lastId === previous.lastId) {
    return { delta: "none", arrived: 0 };
  }
  if (next.firstId !== previous.firstId) {
    return { delta: "prepend", arrived: next.count - previous.count };
  }
  return { delta: "append", arrived: Math.max(0, next.count - previous.count) };
};

export function Thread(props: {
  messages: readonly ChatMessage[];
  botById: (botId: string | undefined) => RosterBot | undefined;
  replyParent: (messageId: string | undefined) => ChatMessage | undefined;
  onToggleReaction: (messageId: string, emoji: string) => void;
}) {
  let scrollRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;

  const [anchor, setAnchor] = createSignal<AnchorState>({ kind: "at-bottom" });
  const [atBottom, setAtBottom] = createSignal(true);
  const [arrivals, setArrivals] = createSignal(0);

  const auto = createAutoScroll({
    working: () => false,
    overflowAnchor: "dynamic",
  });

  const anchoring: ThreadAnchoring = {
    ownership: SCROLL_OWNERSHIP,
    isAtBottom: atBottom,
    userScrolled: auto.userScrolled,
    awayFromBottomArrivals: arrivals,
    resetAwayFromBottomArrivals: () => setArrivals(0),
  };

  createEffect(() => {
    auto.scrollRef(scrollRef);
    auto.contentRef(contentRef);
  });

  const items = createMemo(() => buildTimelineItems(props.messages));
  const now = new Date().getTime();

  const handleScroll = () => {
    const el = scrollRef;
    if (!el) return;
    setAnchor(measureAnchor(el));
    const bottom = isAtBottom(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight,
      AT_BOTTOM_THRESHOLD_PX,
    );
    setAtBottom(bottom);
    if (bottom) setArrivals(0);
    auto.handleScroll();
  };

  createEffect(
    on(
      () => censusKey(props.messages),
      (key, previousKey) => {
        const { delta, arrived } = deltaBetween(
          readCensus(previousKey),
          readCensus(key),
        );
        if (
          shouldSettleForVirtualizedBottom({
            isAtBottom: atBottom(),
            delta,
            arrived,
            changed: delta === "replace",
          })
        ) {
          setArrivals(0);
          return;
        }
        if (arrived > 0) setArrivals(arrivals() + arrived);
      },
    ),
  );

  return (
    <ThreadAnchoringContext.Provider value={anchoring}>
      <div
        class="chat-scroll"
        data-component="chat-scroll"
        ref={(el) => {
          scrollRef = el;
        }}
        onScroll={handleScroll}
      >
        <div
          class="chat-column"
          data-component="chat-column"
          ref={(el) => {
            contentRef = el;
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
            <For each={items()}>
              {(item) => {
                if (item.kind === "day-divider") {
                  return (
                    <div class="chat-divider" data-component="chat-divider">
                      <span class="chat-divider__pill">{formatDayLabel(item.dayStart, now)}</span>
                    </div>
                  );
                }
                return (
                  <Row
                    item={item}
                    bot={props.botById(item.message.botId)}
                    parent={props.replyParent(item.message.replyToId)}
                    onToggleReaction={props.onToggleReaction}
                  />
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </ThreadAnchoringContext.Provider>
  );
}
