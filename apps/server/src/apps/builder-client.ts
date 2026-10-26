import type { Builder, BuildResult, Target } from "./service"

export type BuilderBinding = { build(files: Record<string, string>, target: Target): Promise<BuildResult> }

export function builderFrom(env: { BUILDER?: BuilderBinding }): Builder | null {
  const binding = env.BUILDER
  return binding ? (files, target) => binding.build(files, target) : null
}
