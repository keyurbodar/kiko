import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../lib/types";
import { jumboEmojiClass, replyQuoteText, replySummary } from "./reply";

const base: ChatMessage = { id: "m", threadId: "t", sender: "bot", body: "", sentAt: 0 };
const photo = (src: string) => ({ kind: "photo" as const, src, width: 850, height: 600, alt: "" });
const doc = (name: string) => ({ name, size: 1, mime: "application/pdf", src: `/${name}` });

describe("replySummary", () => {
  test("photo-only quotes as Photo with its thumb", () => {
    expect(replySummary({ ...base, media: [photo("/a.jpg")] })).toEqual({ text: "Photo", thumb: "/a.jpg" });
  });

  test("document with caption keeps the caption and gets the document glyph", () => {
    expect(replySummary({ ...base, body: "Q3 report", documents: [doc("q3.pdf")] })).toEqual({
      text: "Q3 report",
      glyph: "document",
    });
  });

  test("two documents without caption name the first and count the rest", () => {
    expect(replySummary({ ...base, documents: [doc("a.pdf"), doc("b.pdf")] })).toEqual({
      text: "a.pdf and 1 more",
      glyph: "document",
    });
  });

  test("an album of three is Album with the first thumb", () => {
    const media = [photo("/1.jpg"), photo("/2.jpg"), photo("/3.jpg")];
    expect(replySummary({ ...base, media })).toEqual({ text: "Album", thumb: "/1.jpg" });
  });

  test("a link-only message quotes its link, as kat does, with a link glyph", () => {
    const message = {
      ...base,
      body: "https://example.com/x",
      webPage: { url: "https://example.com/x", site: "Example", title: "Hello page" },
    };
    expect(replySummary(message)).toEqual({ text: "https://example.com/x", glyph: "link" });
  });
});


const VS16 = "\uFE0F";

describe("replyQuoteText", () => {
  test("collapses newlines, tabs and runs of spaces into single spaces", () => {
    expect(replyQuoteText("first\n\nsecond\t\tthird     fourth")).toBe(
      "first second third fourth",
    );
  });

  test("trims the ends so a quote never starts or ends on a space", () => {
    expect(replyQuoteText("\n  hello world \n ")).toBe("hello world");
  });

  test("leaves short text untouched", () => {
    expect(replyQuoteText("all good")).toBe("all good");
  });

  test("is empty for nothing to quote", () => {
    expect(replyQuoteText(undefined)).toBe("");
    expect(replyQuoteText(null)).toBe("");
    expect(replyQuoteText("   \n  ")).toBe("");
  });

  test("a 205-character body is cut to 140 characters plus one ellipsis", () => {
    const parent = "a".repeat(205);
    const quote = replyQuoteText(parent);

    expect(quote).toHaveLength(141);
    expect(quote.endsWith("…")).toBe(true);
    expect(quote.slice(0, 140)).toBe("a".repeat(140));
  });

  test("text of exactly the budget is not marked as truncated", () => {
    const quote = replyQuoteText("b".repeat(140));

    expect(quote).toBe("b".repeat(140));
    expect(quote).not.toContain("…");
  });

  test("never cuts through a surrogate pair", () => {
    const parent = "😀".repeat(71);
    const quote = replyQuoteText(parent);

    expect(quote).toBe(`${"😀".repeat(70)}…`);
    expect(Array.from(quote).every((ch) => ch !== "\uFFFD")).toBe(true);
    expect(new TextDecoder().decode(new TextEncoder().encode(quote))).toBe(quote);
  });

  test("never cuts through a combining mark or a ZWJ sequence", () => {
    const family = "👩‍👩‍👧‍👦";
    const quote = replyQuoteText(family.repeat(15));

    expect(quote).toBe(`${family.repeat(12)}…`);
    expect(quote).not.toContain("\uFFFD");
  });

  test("the character budget counts what is shown, not the raw source", () => {
    const parent = `${"x".repeat(100)}\n\n${"y".repeat(100)}`;
    const quote = replyQuoteText(parent);

    expect(quote).toBe(`${"x".repeat(100)} ${"y".repeat(39)}…`);
  });
});

describe("jumboEmojiClass", () => {
  test("one emoji with a variation selector is a single jumbo, not a group", () => {
    expect(jumboEmojiClass(`❓${VS16}`)).toBe("jumbo-single");
    expect(jumboEmojiClass(`❤${VS16}`)).toBe("jumbo-single");
  });

  test("a ZWJ family counts as one emoji, not seven", () => {
    expect(jumboEmojiClass("👨‍👩‍👧‍👦")).toBe("jumbo-single");
    expect(jumboEmojiClass("👍🏽")).toBe("jumbo-single");
  });

  test("two or three emoji make a group, a variation selector not counting", () => {
    expect(jumboEmojiClass(`😀${VS16}🎉`)).toBe("jumbo-group");
    expect(jumboEmojiClass("😀🎉🔥")).toBe("jumbo-group");
  });

  test("four emoji is past the jumbo range", () => {
    expect(jumboEmojiClass("😀🎉🔥🚀")).toBeUndefined();
  });

  test("an emoji with trailing prose is not jumbo", () => {
    expect(jumboEmojiClass("😀 ship it")).toBeUndefined();
    expect(jumboEmojiClass(`❓${VS16} why?`)).toBeUndefined();
  });

  test("ordinary words are not emoji at any length", () => {
    expect(jumboEmojiClass("hi")).toBeUndefined();
    expect(jumboEmojiClass("no")).toBeUndefined();
    expect(jumboEmojiClass("ok!")).toBeUndefined();
  });

  test("an empty or blank body is not jumbo", () => {
    expect(jumboEmojiClass("")).toBeUndefined();
    expect(jumboEmojiClass("  \n ")).toBeUndefined();
  });

  test("surrounding whitespace does not break the classification", () => {
    expect(jumboEmojiClass("  😀  ")).toBe("jumbo-single");
    expect(jumboEmojiClass("\n😀🎉\t")).toBe("jumbo-group");
  });

  test("a keycap sequence is one emoji", () => {
    expect(jumboEmojiClass("1️⃣")).toBe("jumbo-single");
  });

  test("a flag is one emoji, not two regional indicators", () => {
    expect(jumboEmojiClass("\u{1F1EF}\u{1F1F5}")).toBe("jumbo-single");
  });
});