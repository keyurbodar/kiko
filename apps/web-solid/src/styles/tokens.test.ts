import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stylesheets whose type and corners are on the named scales (`--font-*`, `--radius-*`).
const SCALED = [
  "settings/kit.css",
  "sidebar/sidebar.css",
  "search/search.css",
  "palette/palette.css",
  "files/tree.css",
  "files/editor.css",
];

test.each(SCALED)("%s uses named font sizes and radii, not pixel literals", (file) => {
  const css = readFileSync(join(import.meta.dir, "..", file), "utf8");
  const literal = css.match(/^\s*(font-size|border-radius):\s*[0-9.]+px;/gm) ?? [];
  expect(literal).toEqual([]);
});
