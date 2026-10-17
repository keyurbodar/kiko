import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Selectors that must never move: navigation, buttons, menu items, tabs, composer, routes.
const FORBIDDEN =
  /(^|[^a-z])(nav|button|btn|menu-?item|tab|tabs|tablist|composer|rail|sidebar|route)([^a-z]|$)|\[role=["']?(button|menuitem|tab|tablist|navigation)/i;

// Overlays that may enter and leave. They are named by their component, never by a class of a surface.
const OVERLAYS = ["modal-v2-overlay", "modal-v2-content", "menu-v2-content", "hover-card-v2-content", "popover-v2-content", "tooltip-v2"];
const OVERLAY = new RegExp(`^\\[data-component="(${OVERLAYS.join("|")})"\\]\\[data-(expanded|closed)\\]$`);
// The run panel's one transition, t3code's chevron turn. It is named by its component so the
// allowance covers nothing else: no button, tab, or row of the app can use it.
const RUN_PANEL = /^\[data-component="run-panel-chevron"\]$/;
const MOTION_CLASS = /^\.motion-[a-z-]+(\[data-[a-z]+\])?( > span)?$/;

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

test("motion hangs only off an opt-in motion class or a named overlay", () => {
  for (const r of styled) {
    if (!/transition|animation/.test(r.body)) continue;
    for (const raw of r.selector.split(",")) {
      const sel = raw.trim();
      expect(MOTION_CLASS.test(sel) || OVERLAY.test(sel) || RUN_PANEL.test(sel), sel).toBe(true);
    }
  }
});

test("the scanner flags navigation, button, menu item, tab, and composer selectors", () => {
  for (const sel of ["button", ".menu-item", "[role=menuitem]", "[role=tab]", ".composer-input", ".tab-strip", "nav a", ".route-view"]) {
    expect(FORBIDDEN.test(sel), sel).toBe(true);
  }
  for (const sel of [".motion-attachment-in", ".motion-bubble-in", '[data-component="menu-v2-content"][data-expanded]']) {
    expect(FORBIDDEN.test(sel), sel).toBe(false);
  }
  expect(OVERLAY.test('[data-component="menu-v2-content"][data-expanded]')).toBe(true);
  expect(OVERLAY.test('[data-component="menu-v2-item"][data-expanded]')).toBe(false);
  expect(OVERLAY.test('[data-component="tab-strip"][data-expanded]')).toBe(false);
});

test("a transition belongs only to the switch", () => {
  for (const r of styled) {
    if (!/transition\s*:/.test(r.body)) continue;
    if (RUN_PANEL.test(r.selector)) continue;
    expect(r.selector, r.selector).toMatch(/^\.motion-switch/);
  }
});

test("an overlay never delays input", () => {
  for (const r of styled) {
    if (!OVERLAY.test(r.selector.split(",")[0]!.trim())) continue;
    expect(r.body, r.selector).not.toMatch(/animation-delay|pointer-events\s*:\s*none/);
  }
});

test("overlay timings follow t3code", () => {
  const tokens = Object.fromEntries([...css.matchAll(/--motion-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]));
  expect(tokens.dialog).toBe("200ms");
  expect(tokens.popover).toBe("150ms");
  expect(tokens.collapse).toBe("200ms");
  expect(tokens.switch).toBe("150ms");
  expect(tokens.skeleton).toBe("2400ms");
  // t3code's live-tool-shine runs 2.2s, and its chevron turn takes duration-200.
  expect(tokens.shine).toBe("2200ms");
  expect(tokens["run-chevron"]).toBe("200ms");
});

test("all motion is inside prefers-reduced-motion: no-preference", () => {
  const animated = all.filter((r) => /animation|transition|@keyframes/.test(r.body + r.selector));
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

test("keyframes move only transform and opacity, and a collapse also moves height", () => {
  expect(frames.length).toBeGreaterThanOrEqual(5);
  for (const f of frames) {
    const props = [...f.body.matchAll(/(?<![a-z-])([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => p !== "animation-timing-function");
    // The shine moves a gradient across clipped text, which no transform can do.
    const allowed = f.selector.startsWith("@keyframes motion-collapse") ? ["height"] : f.selector === "@keyframes motion-shine" ? ["background-position"] : ["transform", "opacity"];
    for (const p of props) expect(allowed, `${f.selector} ${p}`).toContain(p);
  }
});

test("the allowed motions exist", () => {
  for (const c of ["reaction-pop", "attachment-in", "bubble-in", "reply-in", "collapse", "switch", "skeleton", "popover-in", "spin"]) {
    expect(css).toContain(`.motion-${c}`);
  }
  for (const c of OVERLAYS) expect(css).toContain(`data-component="${c}"`);
});
