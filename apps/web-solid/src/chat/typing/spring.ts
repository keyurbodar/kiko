// Springs as CSS `linear()` easings. The step response of a damped spring is
// sampled once at module load, so the Web Animations API runs it with no
// per-frame JavaScript.

export interface SpringSpec {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface Spring {
  /** Time to settle, in milliseconds. */
  duration: number;
  easing: string;
}

const REST_DELTA = 0.002;
const STEP_S = 1 / 60;
const MAX_S = 2;

/** Position of a spring released from rest at 0 toward 1, at time `t` seconds. */
export function springAt({ stiffness, damping, mass }: SpringSpec, t: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export function createSpring(spec: SpringSpec): Spring {
  let settled = MAX_S;
  for (let t = MAX_S; t > 0; t -= STEP_S) {
    if (Math.abs(1 - springAt(spec, t)) > REST_DELTA) {
      settled = t + STEP_S;
      break;
    }
    settled = t;
  }
  const points: string[] = [];
  const steps = Math.max(2, Math.ceil(settled / STEP_S));
  for (let i = 0; i <= steps; i += 1) {
    const value = i === steps ? 1 : springAt(spec, (i / steps) * settled);
    points.push(String(Math.round(value * 1000) / 1000));
  }
  return { duration: Math.round(settled * 1000), easing: `linear(${points.join(", ")})` };
}

export const SURFACE_SPRING = createSpring({ stiffness: 380, damping: 30, mass: 0.8 });
export const CROSSFADE_SPRING = createSpring({ stiffness: 260, damping: 34, mass: 0.8 });
