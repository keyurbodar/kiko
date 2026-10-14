import { toggleMark } from "@tiptap/pm/commands"
import type { Schema } from "@tiptap/pm/model"
import type { Command } from "@tiptap/pm/state"

export type Binding = { key: string; label: string; command: (schema: Schema) => Command }

/**
 * The marks t3code's composer toggles. Lists, quotes and fences have no chord here: t3code removes
 * Tiptap's block chords because a chord run inside a quote writes a block the draft cannot hold.
 */
export const BINDINGS: readonly Binding[] = [
  { key: "Mod-b", label: "bold", command: (s) => toggleMark(s.marks.bold!) },
  { key: "Mod-i", label: "italic", command: (s) => toggleMark(s.marks.italic!) },
  { key: "Mod-Shift-s", label: "strikethrough", command: (s) => toggleMark(s.marks.strike!) },
  { key: "Mod-e", label: "inline code", command: (s) => toggleMark(s.marks.code!) },
]
