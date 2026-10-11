// The package does not depend on bun-types, so the test runner's API is declared loosely.
declare module "bun:test" {
  export const describe: (name: string, fn: () => void) => void
  export const test: (name: string, fn: () => void | Promise<void>) => void
  // biome-ignore lint/suspicious/noExplicitAny: matchers are not typed here
  export const expect: (value: unknown) => any
}
