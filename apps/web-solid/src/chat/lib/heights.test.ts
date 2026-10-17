import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ChatMessage, MessageFile } from "../../lib/types";
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

/** The same message from the human side. */
function me(id: string, sentAt: Date, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    threadId: "t1",
    sender: "user",
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
    runKey: message.id,
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

  test("the unread rule and the day rule are one divider line", () => {
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
    expect(estimateRowHeight(unread)).toBe(32);
    expect(estimateRowHeight(day)).toBe(32);
  });
});

describe("bubble spacing", () => {
  const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const px = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(css)?.[1]);

  test("two bubbles of one run sit 2px apart and two runs 12px apart", () => {
    expect(px("row-gap") * 2).toBe(2);
    expect(px("row-gap") + px("run-gap")).toBe(12);
  });

  test("the height estimate uses the same gaps as the CSS", () => {
    const body = { body: "same body" };
    const opener = heightOf(bot("a", at(0), body));
    const continuation = heightOf(bot("b", at(1_000), body), false);
    expect(opener - continuation).toBe(px("run-gap") - px("row-gap"));
    expect(continuation).toBe(Math.ceil(14 + 6 + 16 + 2 * px("row-gap")));
  });

  test("an event line is one 16px line with 8px above and below", () => {
    const [item] = buildTimelineItems([bot("e", at(0), { botId: undefined, event: { kind: "compacted", agent: "b1", private: true } as never })]);
    expect(item?.kind).toBe("event");
    expect(estimateRowHeight(item!)).toBe(32);
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

    // 11px of run gap above in place of the row's 1px.
    expect(opener - continuation).toBe(10);
  });

  test("each wrapped line adds one 20px line box", () => {
    const one = heightOf(bot("a", at(0), { body: "short" }));
    const three = heightOf(bot("b", at(0), { body: "z".repeat(200) }));
    // 200 graphemes is three lines at 87 per line; two extra line boxes.
    expect(three - one).toBe(40);
  });

  test("jumbo emoji stays one line however many clusters, and a lone one is the tallest", () => {
    const pair = heightOf(bot("a", at(0), { body: "😀🎉" }));
    const three = heightOf(bot("b", at(0), { body: "😀🎉🚀" }));
    const single = heightOf(bot("c", at(0), { body: "😀" }));

    expect(three).toBe(pair);
    expect(single).toBeGreaterThan(pair);
  });

  test("a quote sits inside the bubble, so a reply is taller than the same bare text", () => {
    const bare = heightOf(bot("a", at(0), { body: "same body" }));
    const quoting = heightOf(bot("b", at(0), { body: "same body", replyToId: "z" }));

    // A 12px/1.35 label line plus two clamped text lines is 48.6px, and the
    // quote adds 5px of padding above, 5px below and a 4px margin.
    expect(quoting - bare).toBe(63);
  });
});

const picture = (name = "a.png"): MessageFile => ({ name, size: 10, type: "image/png", src: `/${name}` });
const pdf = (name = "a.pdf"): MessageFile => ({ name, size: 10, type: "application/pdf", src: `/${name}` });

describe("estimateRowHeight on attachments", () => {
  test("a lone picture reserves a 210px wide 4:3 tile inside the bubble's padding", () => {
    // 16px of bubble padding, a 157.5px tile, the row gaps: 11 run gap and 1 below.
    expect(heightOf(me("a", at(0), { body: "", files: [picture()] }))).toBe(Math.ceil(16 + 157.5 + 11 + 1));
  });

  test("two pictures share one row of half-width tiles, so they are shorter than one", () => {
    const one = heightOf(me("a", at(0), { body: "", files: [picture()] }));
    const two = heightOf(me("b", at(0), { body: "", files: [picture(), picture("b.png")] }));
    const three = heightOf(me("c", at(0), { body: "", files: [picture(), picture("b.png"), picture("c.png")] }));
    expect(two).toBeLessThan(one);
    // A third picture opens a second row: one more 75.75px tile and the 8px gap, 83.75px, rounded up.
    expect(three - two).toBe(84);
  });

  test("text under attachments pays the 8px gap and its line", () => {
    const bare = heightOf(me("a", at(0), { body: "", files: [pdf()] }));
    const captioned = heightOf(me("b", at(0), { body: "short", files: [pdf()] }));
    expect(captioned - bare).toBe(8 + 20);
  });

  test("each file row reserves 28px and the 4px between rows", () => {
    const one = heightOf(me("a", at(0), { body: "", files: [pdf()] }));
    const two = heightOf(me("b", at(0), { body: "", files: [pdf(), pdf("b.pdf")] }));
    expect(two - one).toBe(32);
  });

  test("an old agent message with files reserves the same box as the human's", () => {
    expect(heightOf(bot("a", at(0), { body: "", files: [picture(), pdf()] }))).toBe(heightOf(me("b", at(0), { body: "", files: [picture(), pdf()] })));
  });
});
