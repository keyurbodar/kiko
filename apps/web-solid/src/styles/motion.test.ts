import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Selectors that must never move: navigation, buttons, menus, tabs, composer.
const FORBIDDEN =
  /(^|[^a-z])(nav|button|btn|menu|menuitem|tab|tabs|tablist|composer|rail|sidebar|route)([^a-z]|$)|\[role=["']?(button|menu|menuitem|tab|tablist|navigation)/i;

type Rule = { selector: string; body: string; inMedia: string[] };

/** Every style rule and keyframes block, with the at-rule chain it sits in. */
function rules(src: string): Rule[] {
  const out: Rule[] = [];
  const walk = (text: string, media: string[]) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(body, [...media, head]);
      else out.push({ selector: head, body, inMedia: media });
      i = j;
    }
  };
  walk(src, []);
  return out;
}

const all = rules(css);
const styled = all.filter((r) => !r.selector.startsWith("@keyframes"));
const frames = all.filter((r) => r.selector.startsWith("@keyframes"));

test("no motion is declared on a forbidden selector", () => {
  for (const r of styled) {
    if (!/transition|animation/.test(r.body)) continue;
    for (const sel of r.selector.split(",")) expect(FORBIDDEN.test(sel.trim()), sel).toBe(false);
  }
});

test("the scanner flags navigation, button, menu, tab, and composer selectors", () => {
  for (const sel of ["button", ".menu-item", "[role=tab]", ".composer-input", ".tab-strip", "nav a"]) {
    expect(FORBIDDEN.test(sel), sel).toBe(true);
  }
  for (const sel of [".motion-toast-enter", ".motion-bubble-in", ".motion-reaction-pop"]) {
    expect(FORBIDDEN.test(sel), sel).toBe(false);
  }
});

test("there is no transition property at all", () => {
  expect(css).not.toMatch(/transition\s*:/);
});

test("every animation is inside prefers-reduced-motion: no-preference", () => {
  const animated = all.filter((r) => /animation|@keyframes/.test(r.body + r.selector));
  expect(animated.length).toBeGreaterThan(5);
  for (const r of animated) {
    expect(
      r.inMedia.some((m) => m.includes("prefers-reduced-motion: no-preference")),
      r.selector,
    ).toBe(true);
  }
});

test("durations and easings are tokens", () => {
  for (const r of styled) {
    if (r.selector === ":root") continue;
    const body = r.body.replace(/var\([^)]*\)/g, "");
    expect(body, r.selector).not.toMatch(/\d(ms|s)\b/);
    expect(body, r.selector).not.toMatch(/cubic-bezier|\bease\b|\bease-(in|out|in-out)\b|\blinear\b/);
  }
});

test("keyframes move only transform and opacity", () => {
  expect(frames.length).toBeGreaterThan(5);
  for (const f of frames) {
    const props = [...f.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    for (const p of props) expect(["transform", "opacity"], `${f.selector} ${p}`).toContain(p);
  }
});

test("the allowed motions exist", () => {
  for (const c of ["reaction-pop", "attachment-in", "calendar-open", "toast-enter", "bubble-in", "reply-in"]) {
    expect(css).toContain(`.motion-${c}`);
  }
});
