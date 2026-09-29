import { createEffect, createMemo, For, Show } from "solid-js";
import { createAutoScroll } from "@kiko/ui/hooks";
import type { ChatMessage, RosterBot } from "../lib/types";
import { buildTimelineItems } from "./lib/grouping";
import { formatDayLabel } from "./lib/dayLabel";
import { Row } from "./ui/Row";
import "./chat.css";

export function Thread(props: {
  messages: readonly ChatMessage[];
  botById: (botId: string | undefined) => RosterBot | undefined;
  replyParent: (messageId: string | undefined) => ChatMessage | undefined;
  onToggleReaction: (messageId: string, emoji: string) => void;
}) {
  let scrollRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;

  const auto = createAutoScroll({
    working: () => false,
    overflowAnchor: "dynamic",
  });

  createEffect(() => {
    auto.scrollRef(scrollRef);
    auto.contentRef(contentRef);
  });

  const items = createMemo(() => buildTimelineItems(props.messages));
  const now = new Date().getTime();

  return (
    <div
      class="chat-scroll"
      data-component="chat-scroll"
      ref={(el) => {
        scrollRef = el;
      }}
      onScroll={auto.handleScroll}
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
  );
}
