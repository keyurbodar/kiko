import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge conditional classes, resolving conflicting Tailwind utilities in the
 * last writer's favour.
 *
 * The chat slice styles itself with semantic classes in plain CSS, so the merge
 * half is inert for it. It earns its place for the callers that pass Tailwind
 * utilities through `class`: a component that lets a caller override its
 * padding has to resolve `px-4 px-2` to one of them, and `clsx` alone would
 * emit both and let source order decide.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
