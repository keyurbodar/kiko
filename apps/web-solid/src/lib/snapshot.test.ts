import { afterEach, expect, test } from "bun:test";
import { startSnapshots } from "./snapshot";

const frames: FrameRequestCallback[] = [];
const clock = { now: 0 };
let removed = 0;
let skeleton = false;

const globals = globalThis as Record<string, unknown>;
const realFrame = globals.requestAnimationFrame;
const realDocument = globals.document;
const realNow = performance.now;

/** A boot with one saved layer on screen, and a clock the test moves by hand. */
function boot() {
  frames.length = 0;
  removed = 0;
  skeleton = false;
  clock.now = 0;
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(callback);
  globals.document = {
    getElementById: (id: string) => (id === "snap" ? { remove: () => (removed += 1) } : null),
    querySelector: (selector: string) => (skeleton && selector === '[data-component="page-skeleton"]' ? {} : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
    visibilityState: "visible",
  };
  performance.now = () => clock.now;
}

/** Runs the frame the boot asked for, at `ms` since the boot. */
function frameAt(ms: number) {
  clock.now = ms;
  frames.shift()?.(ms);
}

afterEach(() => {
  if (realFrame === undefined) delete globals.requestAnimationFrame;
  else globals.requestAnimationFrame = realFrame;
  if (realDocument === undefined) delete globals.document;
  else globals.document = realDocument;
  performance.now = realNow;
});

test("the saved screen stays while the app has not painted", () => {
  boot();
  startSnapshots(() => false);
  frameAt(2000);
  expect(removed).toBe(0);
  frameAt(7000);
  expect(removed).toBe(0);
});

test("a boot that never paints hands over at the failsafe, not at 1.5 s", () => {
  boot();
  startSnapshots(() => false);
  frameAt(7999);
  expect(removed).toBe(0);
  frameAt(8001);
  expect(removed).toBe(1);
});

test("the first painted frame hands the screen over", () => {
  boot();
  let ready = false;
  startSnapshots(() => ready);
  frameAt(40);
  expect(removed).toBe(0);
  ready = true;
  frameAt(60);
  expect(removed).toBe(1);
});

test("a route still painting its skeleton is not a paint", () => {
  boot();
  skeleton = true;
  startSnapshots(() => true);
  frameAt(100);
  expect(removed).toBe(0);
  skeleton = false;
  frameAt(120);
  expect(removed).toBe(1);
});
