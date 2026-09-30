import { describe, expect, test } from "bun:test";
import { jumboEmojiClass, replyQuoteText } from "./reply";

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
    // 71 emoji is 142 code units, so a naive slice lands inside emoji #71.
    const parent = "😀".repeat(71);
    const quote = replyQuoteText(parent);

    expect(quote).toBe(`${"😀".repeat(70)}…`);
    expect(Array.from(quote).every((ch) => ch !== "\uFFFD")).toBe(true);
    expect(new TextDecoder().decode(new TextEncoder().encode(quote))).toBe(quote);
  });

  test("never cuts through a combining mark or a ZWJ sequence", () => {
    const family = "👩‍👩‍👧‍👦";
    // 15 families is 165 code units, so the cut lands inside the thirteenth.
    const quote = replyQuoteText(family.repeat(15));

    expect(quote).toBe(`${family.repeat(12)}…`);
    expect(quote).not.toContain("\uFFFD");
  });

  test("the character budget counts what is shown, not the raw source", () => {
    const parent = `${"x".repeat(100)}\n\n${"y".repeat(100)}`;
    const quote = replyQuoteText(parent);

    // 100 + space + 100 collapses to 201, so the cut lands inside the run of y.
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