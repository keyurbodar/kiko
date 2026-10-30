import { render, type RenderOptions } from "./render"
import { resolve, type TraitOptions } from "./traits"

export type AvatarOptions = TraitOptions & RenderOptions

export const defaults = { charm: "none", outfit: "none", pattern: "none", mood: "calm" } satisfies TraitOptions

export function avatar(name: string, options: AvatarOptions = {}): string {
  const pins = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  return render(resolve(name, { ...defaults, ...pins }), options)
}

export { resolve }
export type { RenderOptions } from "./render"
export type { Facing, Pin, TraitOptions, AvatarTraits } from "./traits"
export * from "./catalog"
