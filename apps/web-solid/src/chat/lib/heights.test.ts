import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../lib/types";
import type { TimelineItem } from "./grouping";
import { buildTimelineItems } from "./grouping";
import { estimateRowHeight } from "./heights";

const BASE = new Date(2024, 0, 15, 12, 0, 0);
const at = (ms: number) => new Date(BASE.getTime() + ms);

function bot(id: string, sentAt: Date, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    threadId: "t1",
    sender: "bot",
    botId: "b1",
    body: "hello",
    sentAt: sentAt.getTime(),
    ...extra,
  };
}

/** Height of one real row as the virtualizer will meet it. */
function heightOf(message: ChatMessage, hasRunGapBefore = true): number {
  return estimateRowHeight({
    kind: "message",
    key: `msg:${message.id}`,
    message,
    runIndex: 0,
    runSize: 1,
    isRunStart: hasRunGapBefore,
    isRunEnd: true,
    hasRunGapBefore,
  });
}


const heightsOf = (messages: readonly ChatMessage[]) =>
  buildTimelineItems(messages).map((item) => estimateRowHeight(item));

describe("estimateRowHeight covers every TimelineItem variant", () => {
  test("returns whole pixels for dividers and messages alike", () => {
    const items = buildTimelineItems([
      bot("a", at(0)),
      bot("b", at(1_000)),
      bot("c", new Date(2024, 0, 16, 9, 0, 0)),
    ]);

    for (const item of items) {
      expect(Number.isInteger(estimateRowHeight(item))).toBe(true);
      expect(estimateRowHeight(item)).toBeGreaterThan(0);
    }
    expect(items.map((item) => item.kind)).toEqual(["message", "message", "day-divider", "message"]);
  });

  test("the day chip costs its padding plus one chrome line, the unread rule less", () => {
    const items = buildTimelineItems(
      [
        bot("a", new Date(2024, 0, 15, 23, 0, 0)),
        bot("b", new Date(2024, 0, 16, 9, 0, 0)),
        bot("c", new Date(2024, 0, 16, 9, 1, 0)),
      ],
      "b",
    );
    const day = items.find((item) => item.kind === "day-divider");
    const unread = items.find((item) => item.kind === "unread-divider");

    if (!day || day.kind !== "day-divider" || !unread || unread.kind !== "unread-divider") {
      throw new Error("expected both dividers");
    }
    // 14+10 of day padding against 12+8 of unread padding.
    expect(estimateRowHeight(day) - estimateRowHeight(unread)).toBe(4);
  });
});

describe("estimateRowHeight on bubbles", () => {
  test("every row of a run reports the same height, and the run opener is taller", () => {
    const [a, b, c] = heightsOf([
      bot("a", at(0)),
      bot("b", at(10_000)),
      bot("c", at(20_000), { body: "a much longer second message that still fits one line" }),
    ]);

    expect(b).toBe(c);
    expect(a).not.toBe(b);
  });

  test("a run break costs the group-gap padding, which replaces the row padding", () => {
    const opener = heightOf(bot("a", at(0), { body: "same body" }));
    const continuation = heightOf(bot("b", at(1_000), { body: "same body" }), false);

    // 8px of .group-gap padding-top in place of the row's 1px.
    expect(opener - continuation).toBe(7);
  });

  test("each wrapped line adds one 20.3px line box, rounded up", () => {
    const one = heightOf(bot("a", at(0), { body: "short" }));
    const three = heightOf(bot("b", at(0), { body: "z".repeat(200) }));
    // 200 graphemes is three lines at 87 per line; two extra line boxes.
    expect(three - one).toBe(40);
  });

  test("jumbo emoji stays one line however many clusters, and grows past text", () => {
    const text = heightOf(bot("a", at(0), { body: "short" }));
    const group = heightOf(bot("b", at(0), { body: "😀🎉" }));
    const single = heightOf(bot("c", at(0), { body: "😀" }));

    expect(group).toBeGreaterThan(text);
    expect(single).toBeGreaterThan(group);
  });

  test("a quote sits inside the bubble, so a reply is taller than the same bare text", () => {
    const bare = heightOf(bot("a", at(0), { body: "same body" }));
    const quoting = heightOf(bot("b", at(0), { body: "same body", replyToId: "z" }));

    // A 12px/1.35 label line plus two clamped text lines is 48.6px, and the
    // quote adds 5px of padding above, 5px below and a 4px margin.
    expect(quoting - bare).toBe(62);
  });
});