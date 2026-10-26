import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { parseRecipe, RecipeError } from "./recipe"

const RECIPE = `---
name: inbox-zero
title: Inbox zero
description: Read the inbox and answer what matters
when: every morning
tags: [inbox]
agent:
  handle: inbox
---
Read the inbox and answer what matters.`

const parsed = (content: string, dir: string) =>
  Effect.try({ try: () => parseRecipe(content, dir), catch: (error) => error as RecipeError })

describe("parseRecipe", () => {
  it("reads a recipe", () => {
    const recipe = parseRecipe(RECIPE, "inbox-zero")
    assert.strictEqual(recipe.slug, "inbox-zero")
    assert.strictEqual(recipe.agent.handle, "inbox")
  })

  it.effect("fails with a tagged error naming the folder", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parsed(RECIPE, "other-folder"))
      const failure =
        Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail" ? exit.cause.reasons[0].error : null
      assert.strictEqual(failure?._tag, "RecipeError")
      assert.strictEqual(failure?.slug, "other-folder")
      assert.strictEqual(failure?.message, "recipe other-folder: name inbox-zero must match its folder")
    }),
  )

  it.effect("fails when a required line is missing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parsed(RECIPE.replace("title: Inbox zero\n", ""), "inbox-zero"))
      const failure =
        Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail" ? exit.cause.reasons[0].error : null
      assert.strictEqual(failure?._tag, "RecipeError")
      assert.strictEqual(failure?.message, "recipe inbox-zero: title is required")
    }),
  )
})
