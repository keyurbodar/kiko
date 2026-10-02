import { describe, expect, test } from "bun:test";
import { createSpring, CROSSFADE_SPRING, springAt, SURFACE_SPRING } from "./spring";

describe("spring easing", () => {
  test("starts at 0 and ends at 1", () => {
    const spec = { stiffness: 380, damping: 30, mass: 0.8 };
    expect(springAt(spec, 0)).toBeCloseTo(0, 6);
    expect(springAt(spec, 5)).toBeCloseTo(1, 4);
  });

  test("the surface spring overshoots, the crossfade spring does not", () => {
    const peak = (spec: { stiffness: number; damping: number; mass: number }) =>
      Math.max(...Array.from({ length: 200 }, (_, i) => springAt(spec, i / 100)));
    expect(peak({ stiffness: 380, damping: 30, mass: 0.8 })).toBeGreaterThan(1.001);
    expect(peak({ stiffness: 260, damping: 34, mass: 0.8 })).toBeLessThanOrEqual(1.0001);
  });

  test("emits a linear() easing that ends on exactly 1 with a sane duration", () => {
    for (const s of [SURFACE_SPRING, CROSSFADE_SPRING]) {
      expect(s.easing.startsWith("linear(0, ")).toBe(true);
      expect(s.easing.endsWith(", 1)")).toBe(true);
      expect(s.duration).toBeGreaterThan(100);
      expect(s.duration).toBeLessThan(1500);
    }
  });

  test("a stiffer spring settles sooner", () => {
    const soft = createSpring({ stiffness: 100, damping: 15, mass: 1 });
    const stiff = createSpring({ stiffness: 800, damping: 40, mass: 1 });
    expect(stiff.duration).toBeLessThan(soft.duration);
  });
});
