import type { JSX } from "solid-js"
import { cn } from "../lib/cn"

const chipClass = "type-sm flex h-6 min-w-0 shrink items-center gap-1.5 rounded-full bg-tertiary px-2 text-secondary"

export function RecipeChip(props: { class?: string; children: JSX.Element }) {
  return <span class={cn(chipClass, props.class)}>{props.children}</span>
}
