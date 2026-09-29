import { describe, expect, test } from "bun:test";
import { decideLoadEarlier } from "./loadEarlier";

describe("decideLoadEarlier", () => {
  test("a sentinel entering the band loads one page and disarms", () => {
    const decision = decideLoadEarlier(true, { armed: true, isLoading: false, hasOlder: true });
    expect(decision.shouldLoad).toBe(true);
    expect(decision.armed).toBe(false);
  });

  test("a sentinel still inside the band does not cascade a second page", () => {
    const first = decideLoadEarlier(true, { armed: true, isLoading: false, hasOlder: true });
    const second = decideLoadEarlier(true, {
      armed: first.armed,
      isLoading: false,
      hasOlder: true,
    });
    expect(second.shouldLoad).toBe(false);
    expect(second.armed).toBe(false);
  });

  test("leaving the band re-arms for the next scroll-up gesture", () => {
    const left = decideLoadEarlier(false, { armed: false, isLoading: false, hasOlder: true });
    expect(left.shouldLoad).toBe(false);
    expect(left.armed).toBe(true);
  });

  test("re-entering after a leave loads exactly one more page", () => {
    const left = decideLoadEarlier(false, { armed: false, isLoading: false, hasOlder: true });
    const reentered = decideLoadEarlier(true, {
      armed: left.armed,
      isLoading: false,
      hasOlder: true,
    });
    expect(reentered.shouldLoad).toBe(true);
  });

  test("no older messages never loads and never arms", () => {
    const decision = decideLoadEarlier(true, { armed: true, isLoading: false, hasOlder: false });
    expect(decision.shouldLoad).toBe(false);
    expect(decision.armed).toBe(false);
  });

  test("an in-flight load blocks a second trigger without disarming", () => {
    const decision = decideLoadEarlier(true, { armed: true, isLoading: true, hasOlder: true });
    expect(decision.shouldLoad).toBe(false);
    expect(decision.armed).toBe(true);
  });

  test("a full gesture cycle still pages exactly once", () => {
    let state = { armed: true, isLoading: false, hasOlder: true };
    let loads = 0;

    const step = (intersecting: boolean, loading: boolean) => {
      const decision = decideLoadEarlier(intersecting, { ...state, isLoading: loading });
      state = { ...state, armed: decision.armed };
      if (decision.shouldLoad) loads += 1;
    };

    step(true, false);
    step(true, true);
    step(true, false);
    step(true, true);
    step(false, false);
    step(true, false);

    expect(loads).toBe(2);
  });
});
