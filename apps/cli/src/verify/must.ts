/** Returns `value` when it is present; throws otherwise. Use instead of a non-null assertion. */
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}, got ${String(value)}`)
  return value
}
