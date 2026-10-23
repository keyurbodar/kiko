import { Fragment, type Schema } from "@tiptap/pm/model"

export type Point = { x: number; y: number }

export function chipFragment(
  schema: Schema,
  chips: readonly { type: string; attrs: Record<string, unknown> }[],
  before: string | undefined,
): Fragment {
  const space = schema.text(" ")
  const nodes = chips.flatMap((chip) => [schema.nodes[chip.type]!.create(chip.attrs), space])
  return Fragment.from(before !== undefined && !/\s/.test(before) ? [space, ...nodes] : nodes)
}
