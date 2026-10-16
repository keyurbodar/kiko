import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../lib/types";
import {
  MESSAGE_GROUPING_WINDOW_MS,
  buildTimelineItems,
  canGroup,
  dayStartOf,
  firstUnreadIndex,
  keepUnchanged,
  type TimelineItem,
} from "./grouping";

const BASE = new Date(2024, 0, 15, 12, 0, 0);
const at = (ms: number) => new Date(BASE.getTime() + ms);

function bot(id: string, sentAt: Date, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, threadId: "t1", sender: "bot", botId: "b1", body: "hello", sentAt: sentAt.getTime(), ...extra };
}
function user(id: string, sentAt: Date, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, threadId: "t1", sender: "user", body: "hi", sentAt: sentAt.getTime(), ...extra };
}

const messageRows = (items: TimelineItem[]) =>
  items.filter((item): item is Extract<TimelineItem, { kind: "message" }> => item.kind === "message");

describe("canGroup", () => {
  test("holds the window open at exactly 300s and closes it a millisecond later", () => {
    expect(canGroup(bot("a", at(0)), bot("b", at(300_000)))).toBe(true);
    expect(canGroup(bot("a", at(0)), bot("b", at(300_001)))).toBe(false);
  });

  test("treats a negative gap as a break rather than a group", () => {
    expect(canGroup(bot("a", at(60_000)), bot("b", at(0)))).toBe(false);
  });

  test("separates two bots and separates a bot from the viewer", () => {
    expect(canGroup(bot("a", at(0)), bot("b", at(1_000), { botId: "b2" }))).toBe(false);
    expect(canGroup(bot("a", at(0)), user("b", at(1_000)))).toBe(false);
  });

  test("separates a bot whose botId is absent from one that carries it", () => {
    expect(canGroup(bot("a", at(0), { botId: undefined }), bot("b", at(1_000)))).toBe(false);
  });
});

describe("buildTimelineItems run shaping", () => {
  test("a run that wraps past 300s splits into two runs of one", () => {
    const items = buildTimelineItems([
      bot("a", at(0)),
      bot("b", at(MESSAGE_GROUPING_WINDOW_MS + 1)),
    ]);
    const [a, b] = messageRows(items);

    expect(a.runSize).toBe(1);
    expect(b.runSize).toBe(1);
    expect(a.isRunStart).toBe(true);
    expect(b.isRunStart).toBe(true);
    expect(b.hasRunGapBefore).toBe(true);
    expect(b.isRunEnd).toBe(true);
  });

  test("a run inside the window reports its position, size and shared height", () => {
    const items = buildTimelineItems([
      bot("a", at(0)),
      bot("b", at(10_000)),
      bot("c", at(20_000)),
      user("d", at(21_000)),
    ]);
    const [a, b, c, d] = messageRows(items);

    expect([a.runIndex, b.runIndex, c.runIndex, d.runIndex]).toEqual([0, 1, 2, 0]);
    expect([a.runSize, b.runSize, c.runSize, d.runSize]).toEqual([3, 3, 3, 1]);
    expect([a.isRunStart, b.isRunStart, c.isRunStart, d.isRunStart]).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect([a.isRunEnd, b.isRunEnd, c.isRunEnd, d.isRunEnd]).toEqual([false, false, true, true]);
    // Only the row that opens a run carries the 8px gap above it.
    expect([a.hasRunGapBefore, b.hasRunGapBefore, c.hasRunGapBefore, d.hasRunGapBefore]).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  test("a reply breaks its own run without disturbing the run above it", () => {
    const items = buildTimelineItems([
      bot("a", at(0)),
      bot("b", at(1_000)),
      bot("c", at(2_000), { replyToId: "a" }),
    ]);
    const [a, b, c] = messageRows(items);

    expect(a.runSize).toBe(2);
    expect(b.runSize).toBe(2);
    expect(b.isRunEnd).toBe(true);
    expect(c.runSize).toBe(1);
    expect(c.isRunStart).toBe(true);
  });

  test("a message with replyToId never joins the run above it", () => {
    const items = buildTimelineItems([
      bot("a", at(0)),
      bot("b", at(1), { replyToId: "z" }),
    ]);

    expect(messageRows(items).map((row) => row.runSize)).toEqual([1, 1]);
  });

  test("the row that was replied to does not absorb the reply by counting", () => {
    const items = buildTimelineItems([
      bot("a", at(0), { replyToId: "z" }),
      bot("b", at(0)),
    ]);

    expect(messageRows(items).map((row) => row.runSize)).toEqual([1, 1]);
  });

  test("a day change splits the run and inserts exactly one day divider", () => {
    const items = buildTimelineItems([
      bot("a", new Date(2024, 0, 15, 23, 59, 0)),
      bot("b", new Date(2024, 0, 16, 0, 1, 0)),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["message", "day-divider", "message"]);
    expect(messageRows(items).map((row) => row.runSize)).toEqual([1, 1]);
    expect(items[1]).toMatchObject({
      dayStart: dayStartOf(new Date(2024, 0, 16, 0, 1, 0).getTime()),
    });
  });

  test("a three-day feed emits one divider per boundary and none for the first row", () => {
    const items = buildTimelineItems([
      bot("a", new Date(2024, 0, 15, 9, 0, 0)),
      bot("b", new Date(2024, 0, 16, 9, 0, 0)),
      bot("c", new Date(2024, 0, 17, 9, 0, 0)),
    ]);

    expect(items.filter((item) => item.kind === "day-divider")).toHaveLength(2);
  });

  test("an empty thread produces no items", () => {
    expect(buildTimelineItems([])).toEqual([]);
  });

  test("every key is unique so the virtualizer can index rows", () => {
    const items = buildTimelineItems([
      bot("a", new Date(2024, 0, 15, 9, 0, 0)),
      bot("b", new Date(2024, 0, 16, 9, 0, 0)),
      user("c", new Date(2024, 0, 16, 9, 0, 30)),
    ]);

    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});

describe("buildTimelineItems unread rule", () => {
  const thread = [user("u0", at(0)), bot("b1", at(1_000)), bot("b2", at(2_000))];

  test("the rule lands on the row immediately above the first unread message", () => {
    const items = buildTimelineItems(thread, "b1");

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "unread-divider",
      "message",
      "message",
    ]);
    expect(items[1]).toMatchObject({ afterMessageId: "b1" });
    expect(firstUnreadIndex(items, "b1")).toBe(1);
  });

  test("a chat opened with one unread reply, the newest message, still gets the rule", () => {
    const items = buildTimelineItems(thread, "b2");

    expect(items.map((item) => item.kind)).toEqual(["message", "message", "unread-divider", "message"]);
    expect(firstUnreadIndex(items, "b2")).toBe(2);
  });

  test("no rule is emitted for a message the viewer sent", () => {
    const items = buildTimelineItems(thread, "u0");

    expect(items.some((item) => item.kind === "unread-divider")).toBe(false);
    expect(firstUnreadIndex(items, "u0")).toBe(-1);
  });

  test("a rule on the same message as a day change sits below the day divider", () => {
    const items = buildTimelineItems(
      [
        user("u0", new Date(2024, 0, 15, 23, 0, 0)),
        bot("b1", new Date(2024, 0, 16, 9, 0, 0)),
        bot("b2", new Date(2024, 0, 16, 9, 1, 0)),
      ],
      "b1",
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "day-divider",
      "unread-divider",
      "message",
      "message",
    ]);
  });

  test("firstUnreadIndex is -1 without an id or with an id that was never seen", () => {
    const items = buildTimelineItems(thread);

    expect(firstUnreadIndex(items, null)).toBe(-1);
    expect(firstUnreadIndex(items, "nope")).toBe(-1);
  });

  test("the rule does not disturb the runs either side of it", () => {
    const items = buildTimelineItems(thread, "b1");
    const [b1, b2] = messageRows(items).filter((row) => row.message.sender === "bot");

    expect(b1.runSize).toBe(2);
    expect(b2.runSize).toBe(2);
    expect(b2.runIndex).toBe(1);
  });
});

describe("dayStartOf", () => {
  test("lands on local midnight regardless of the time of day", () => {
    const early = dayStartOf(new Date(2024, 0, 15, 0, 0, 0).getTime());
    const late = dayStartOf(new Date(2024, 0, 15, 23, 59, 59).getTime());

    expect(early).toBe(dayStartOf(new Date(2024, 0, 15, 12, 0, 0).getTime()));
    expect(late).toBe(early);
    expect(new Date(early).getHours()).toBe(0);
  });
});

describe("time dividers", () => {
  test("a burst gets none, and one pause over twenty minutes gets exactly one", () => {
    const items = buildTimelineItems([
      bot("a", at(0)),
      bot("b", at(5 * 60_000)),
      bot("c", at(5 * 60_000 + 20 * 60_000 + 1)),
      bot("d", at(5 * 60_000 + 20 * 60_000 + 1 + 1_000)),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["message", "message", "day-divider", "message", "message"]);
    expect(items.filter((item) => item.kind === "day-divider").map((item) => item.key)).toEqual(["gap:c"]);
  });
});
describe("group timeline", () => {
  const members = new Set(["kiko", "piko"]);
  const shape = (items: TimelineItem[]) =>
    items.map((item) =>
      item.kind === "message"
        ? `${item.message.id}${item.isRunStart ? "<" : ""}${item.isRunEnd ? ">" : ""}`
        : item.kind === "thread"
          ? `thread(${item.messages.map((m) => m.id).join(",")}${item.expanded ? " open" : ""})`
          : item.kind === "event"
            ? `event:${item.message.event?.kind}`
            : item.kind,
    );
  /** `to` is who the room says the message was sent to; the body never decides. */
  const k = (id: string, seq: number, to?: string, body = "hi") => bot(id, at(seq * 1000), { botId: "kiko", seq, body, ...(to ? { to } : {}) });
  const kind = (id: string, seq: number, kind: string) => bot(id, at(seq * 1000), { botId: undefined, seq, event: { kind, slug: "piko", name: "Piko", private: true } as never });
  const p = (id: string, seq: number, to?: string, body = "hi") => bot(id, at(seq * 1000), { botId: "piko", seq, body, ...(to ? { to } : {}) });

  test.each([
    ["an event line sits by seq and ends the run above it", [k("a", 1), kind("n", 2, "member_added"), k("b", 3)], [], undefined, ["a<>", "event:member_added", "b<>"]],
    ["an event line past every message goes last", [k("a", 1), kind("n", 5, "member_removed")], [], undefined, ["a<>", "event:member_removed"]],
    ["an event kind this client does not draw is hidden and does not end the run", [k("a", 1), kind("n", 2, "from_a_newer_server"), k("b", 3)], [], undefined, ["a<", "b>"]],
    ["agents addressing each other fold into one thread", [k("a", 1), k("b", 2, "piko"), p("c", 3, "kiko"), k("d", 4)], [], undefined, ["a<>", "thread(b,c)", "d<>"]],
    ["an open thread's messages follow it and run among themselves", [k("b", 2, "piko"), k("c", 3, "piko"), k("d", 4)], [], "thread:b", ["thread(b,c open)", "b<", "c>", "d<>"]],
    ["a message to every agent folds too", [k("a", 1), k("b", 2, "all"), k("c", 3)], [], undefined, ["a<>", "thread(b)", "c<>"]],
    ["a reply to the human that starts by naming a teammate stays in view", [k("a", 1, undefined, "@piko found these, here is the summary")], [], undefined, ["a<>"]],
  ] as const)("%s", (_name, messages, _unused, open, want) => {
    const items = buildTimelineItems(messages as unknown as ChatMessage[], null, {
      members,
      expanded: new Set(open ? [open] : []),
    });
    expect(shape(items)).toEqual([...want]);
  });

  test("a one-agent room folds nothing", () => {
    expect(shape(buildTimelineItems([k("a", 1, "piko")], null, {}))).toEqual(["a<>"]);
  });
});

describe("keepUnchanged", () => {
  const a = bot("a", at(0));
  const b = bot("b", at(1_000));
  const c = bot("c", at(2_000));

  test("an unchanged row keeps its object, so the virtual list keeps its DOM", () => {
    const seen = new Map<string, TimelineItem>();
    const first = keepUnchanged(seen, buildTimelineItems([a, b], null));
    const second = keepUnchanged(seen, buildTimelineItems([a, b], null));
    expect(second).toHaveLength(first.length);
    second.forEach((item, i) => expect(item).toBe(first[i]));
  });

  test("a row that only moved inside its run keeps its object, and its run fields follow", () => {
    const seen = new Map<string, TimelineItem>();
    const [, rowB] = messageRows(keepUnchanged(seen, buildTimelineItems([a, b], null)));
    const [, rowB2, rowC] = messageRows(keepUnchanged(seen, buildTimelineItems([a, b, c], null)));
    // b ended the run and now sits inside it. Rebuilding it would replay its entry animation.
    expect(rowB2).toBe(rowB);
    expect(rowB2.isRunEnd).toBe(false);
    expect(rowC.message).toBe(c);
  });

  test("a row whose message changed is a new object", () => {
    const seen = new Map<string, TimelineItem>();
    const [rowA] = messageRows(keepUnchanged(seen, buildTimelineItems([a, b, c], null)));
    const edited = { ...a, body: "edited" };
    const [rowA2] = messageRows(keepUnchanged(seen, buildTimelineItems([edited, b, c], null)));
    expect(rowA2).not.toBe(rowA);
    expect(rowA2.message.body).toBe("edited");
  });
});

test("a legacy worker line is hidden and does not break a reply run", () => {
  const legacy = { kind: "subagent", agent: "b1", state: "started", title: "Check inbox", private: true } as never;
  const items = buildTimelineItems([bot("a", at(0)), bot("start", at(1_000), { event: legacy }), bot("b", at(2_000))]);
  expect(items.map((i) => i.key)).toEqual(["msg:a", "msg:b"]);
  expect(messageRows(items).map((i) => i.runSize)).toEqual([2, 2]);
});

test("a hidden event passes the unread divider to the next reply", () => {
  const legacy = { kind: "subagent", agent: "b1", state: "done", title: "Check inbox", private: true } as never;
  const background = bot("background", at(0), { event: legacy });
  expect(buildTimelineItems([background])).toEqual([]);
  const items = buildTimelineItems([background, bot("reply", at(1_000)), bot("next", at(2_000))], "background");
  expect(items.find((i) => i.kind === "unread-divider")?.key).toBe("unread:reply");
});
