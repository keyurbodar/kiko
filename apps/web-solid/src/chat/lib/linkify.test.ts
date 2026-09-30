import { describe, expect, test } from "bun:test";
import { linkifySegments, previewHostOf } from "./linkify";

/** Just the anchors a body would render, as `[displayText, href]` pairs. */
function anchors(text: string): [string, string][] {
  return linkifySegments(text)
    .filter((segment) => segment.href !== null)
    .map((segment) => [segment.text, segment.href as string]);
}

/** The body as the reader sees it: every run's text, concatenated. */
function rendered(text: string): string {
  return linkifySegments(text)
    .map((segment) => segment.text)
    .join("");
}

describe("linkifySegments", () => {
  test("a bare https url becomes one anchor, text preserved exactly", () => {
    expect(anchors("https://example.com/a/b?c=d")).toEqual([
      ["https://example.com/a/b?c=d", "https://example.com/a/b?c=d"],
    ]);
  });

  test("a trailing full stop stays outside the href", () => {
    expect(anchors("see https://example.com.")).toEqual([
      ["https://example.com", "https://example.com"],
    ]);
    expect(rendered("see https://example.com.")).toBe("see https://example.com.");
  });

  test("two urls keep the prose between them intact", () => {
    const body = "first https://a.example.com then https://b.example.com end";
    expect(anchors(body)).toEqual([
      ["https://a.example.com", "https://a.example.com"],
      ["https://b.example.com", "https://b.example.com"],
    ]);
    expect(rendered(body)).toBe(body);
  });

  test("a scheme-less www run links over https but displays what was typed", () => {
    expect(anchors("www.example.com")).toEqual([
      ["www.example.com", "https://www.example.com"],
    ]);
    expect(rendered("www.example.com")).toBe("www.example.com");
  });

  test("a bare scheme degrades to text instead of throwing", () => {
    expect(() => linkifySegments("http://")).not.toThrow();
    expect(anchors("http://")).toEqual([]);
    expect(rendered("http://")).toBe("http://");
  });

  test("an email address is not an anchor", () => {
    expect(anchors("write to me@example.com")).toEqual([]);
    expect(rendered("write to me@example.com")).toBe("write to me@example.com");
  });

  test("a hashtag and a mention are not anchors", () => {
    const body = "#release and @someone shipped it";
    expect(anchors(body)).toEqual([]);
    expect(rendered(body)).toBe(body);
  });
});

describe("previewHostOf", () => {
  test("drops the www prefix from the host", () => {
    expect(previewHostOf("https://www.example.com/a/b")).toBe("example.com");
  });

  test("keeps a subdomain that is not www", () => {
    expect(previewHostOf("https://docs.example.com/x")).toBe("docs.example.com");
  });

  test("returns an unparseable href unchanged rather than throwing", () => {
    expect(() => previewHostOf("not a url")).not.toThrow();
    expect(previewHostOf("not a url")).toBe("not a url");
  });
});
