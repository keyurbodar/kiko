import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./rich.css", import.meta.url), "utf8");

describe("jumbo emoji in the server copy", () => {
  test("a ghost bubble's rich text follows the bubble size instead of the 14px .rich sets", () => {
    const rule = css.match(/\[data-slot="bubble"\]\[data-variant="ghost"\] \.rich \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("font-size: inherit");
    expect(rule![1]).toContain("line-height: inherit");
  });
});
