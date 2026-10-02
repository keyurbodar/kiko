import { describe as suite, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { type Clock, createTypingPresence, describe, SEND_MS } from "./create-typing-presence";

function fakeClock() {
  let t = 1000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const clock: Clock = {
    now: () => t,
    after: (fn, ms) => {
      const key = id++;
      timers.set(key, { at: t + ms, fn });
      return () => void timers.delete(key);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  return { clock, advance, pending: () => timers.size };
}

function setup() {
  const c = fakeClock();
  let dispose = () => {};
  const p = createRoot((d) => {
    dispose = d;
    return createTypingPresence({ clock: c.clock });
  });
  return { p, ...c, dispose };
}

suite("describe", () => {
  test("table", () => {
    const cases: [string[], number, string][] = [
      [[], 2, ""],
      [["ana"], 2, "ana is typing"],
      [["ana", "bo"], 2, "ana and bo are typing"],
      [["ana", "bo", "cy"], 2, "ana, bo and 1 other are typing"],
      [["ana", "bo", "cy", "di"], 2, "ana, bo and 2 others are typing"],
      [["ana", "bo", "cy"], 3, "ana, bo and cy are typing"],
      [["ana", "bo"], 0, "ana and 1 other are typing"],
    ];
    for (const [names, max, out] of cases) expect(describe(names, max)).toBe(out);
  });
});

suite("typing presence", () => {
  test("a ping shows the typist and counts a beat per ping", () => {
    const { p } = setup();
    p.ping("ana");
    expect(p.typists()).toEqual(["ana"]);
    expect(p.beat()).toBe(1);
    p.ping("ana");
    expect(p.beat()).toBe(2);
    expect(p.typists()).toEqual(["ana"]);
    p.ping("bo");
    expect(p.typists()).toEqual(["ana", "bo"]);
  });

  test("a typist times out after 3000 ms without a ping", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(2999);
    expect(p.typists()).toEqual(["ana"]);
    advance(1);
    expect(p.typists()).toEqual([]);
    expect(p.beat()).toBe(0);
  });

  test("a fresh ping extends the timeout", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(2000);
    p.ping("ana");
    advance(2000);
    expect(p.typists()).toEqual(["ana"]);
    advance(1000);
    expect(p.typists()).toEqual([]);
  });

  test("timeouts are per typist", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(1500);
    p.ping("bo");
    advance(1500);
    expect(p.typists()).toEqual(["bo"]);
  });

  test("a cleared typist stays visible until the 900 ms minimum", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(300);
    p.clear("ana");
    expect(p.typists()).toEqual(["ana"]);
    advance(599);
    expect(p.typists()).toEqual(["ana"]);
    advance(1);
    expect(p.typists()).toEqual([]);
  });

  test("a clear after the minimum hides at once", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(1000);
    p.clear("ana");
    expect(p.typists()).toEqual([]);
  });

  test("clearing an unknown name does nothing", () => {
    const { p } = setup();
    p.clear("ghost");
    expect(p.typists()).toEqual([]);
    expect(p.beat()).toBe(0);
  });

  test("send while typing starts the send phase and ends it after 340 ms", () => {
    const { p, advance } = setup();
    p.ping("ana");
    p.send("ana");
    expect(p.sending()).toBe(true);
    expect(p.typists()).toEqual(["ana"]);
    advance(SEND_MS - 1);
    expect(p.sending()).toBe(true);
    advance(1);
    expect(p.sending()).toBe(false);
    expect(p.typists()).toEqual([]);
    expect(p.beat()).toBe(0);
  });

  test("send from someone who is not typing is ignored", () => {
    const { p } = setup();
    p.send("ana");
    expect(p.sending()).toBe(false);
  });

  test("the sweep does not hide a typist who is sending", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(2900);
    p.send("ana");
    advance(SEND_MS);
    expect(p.typists()).toEqual([]);
    expect(p.sending()).toBe(false);
  });

  test("a ping during the send phase cancels it and shows the new typist", () => {
    const { p, advance } = setup();
    p.ping("ana");
    p.send("ana");
    advance(100);
    p.ping("bo");
    expect(p.sending()).toBe(false);
    expect(p.typists()).toEqual(["bo"]);
    advance(SEND_MS);
    expect(p.typists()).toEqual(["bo"]);
    expect(p.sending()).toBe(false);
  });

  test("another typist who kept typing survives the end of a send", () => {
    const { p, advance } = setup();
    p.ping("ana");
    p.ping("bo");
    p.send("ana");
    advance(SEND_MS);
    expect(p.sending()).toBe(false);
    expect(p.typists()).toEqual(["bo"]);
  });

  test("reset clears everything and cancels timers", () => {
    const { p, advance, pending } = setup();
    p.ping("ana");
    p.send("ana");
    p.reset();
    expect(p.typists()).toEqual([]);
    expect(p.sending()).toBe(false);
    expect(p.beat()).toBe(0);
    expect(pending()).toBe(0);
    advance(5000);
    expect(p.typists()).toEqual([]);
  });

  test("disposing the owner cancels timers", () => {
    const { p, dispose, pending } = setup();
    p.ping("ana");
    dispose();
    expect(pending()).toBe(0);
  });

  test("the sweep never fires sooner than 24 ms", () => {
    const { p, advance } = setup();
    p.ping("ana");
    advance(2990);
    p.ping("bo");
    // ana expires in 10 ms, the floor delays the sweep to 24 ms
    advance(20);
    expect(p.typists()).toEqual(["ana", "bo"]);
    advance(10);
    expect(p.typists()).toEqual(["bo"]);
  });
});
