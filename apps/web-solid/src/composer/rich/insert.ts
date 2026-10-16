import { Fragment, type Schema } from "@tiptap/pm/model"

export type Point = { x: number; y: number }

/**
 * The nodes a drop puts in the text: each chip followed by a space, and a space first when the
 * character before is not one, so a chip dropped against a word does not glue to it. `before` is
 * the character just left of the drop, or undefined at the start of a block.
 */
export function chipFragment(schema: Schema, chips: readonly { type: string; attrs: Record<string, unknown> }[], before: string | undefined): Fragment {
  const space = schema.text(" ")
  const nodes = chips.flatMap((chip) => [schema.nodes[chip.type]!.create(chip.attrs), space])
  return Fragment.from(before !== undefined && !/\s/.test(before) ? [space, ...nodes] : nodes)
}
