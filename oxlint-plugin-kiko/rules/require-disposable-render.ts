import { defineRule, type ESTree } from "@oxlint/plugins"
import * as Option from "effect/Option"

import { getPropertyName, unwrapExpression } from "../utils.ts"

const BROWSER_TEST_FILE = /\.browser\.test\.[cm]?[jt]sx?$/u
const LIFECYCLE_HOOKS = new Set(["afterAll", "afterEach", "beforeAll", "beforeEach"])
const TEST_RUNNERS = new Set(["@effect/vitest", "vitest"])
const SOLID_MOUNTS = new Set(["render", "hydrate", "insert"])
const HELPER = "Render with `await using screen = await render(...)` from apps/web-solid/test/render.tsx"

const MESSAGES = {
  testingLibrary: `${HELPER}; it wraps @solidjs/testing-library and disposes the tree and its container when the test ends.`,
  solidWeb: `${HELPER}; it owns the Solid root and unmounts it on dispose.`,
  lifecycleHook:
    "Browser tests acquire what they need with `using`/`await using` instead of lifecycle hooks, so nothing outlives the test that created it.",
}

const importedName = (specifier: ESTree.ImportSpecifier) =>
  specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require web component tests to render through the disposable test helper instead of mounting Solid roots or using lifecycle hooks by hand.",
    },
  },
  create(context) {
    const isBrowserTest = BROWSER_TEST_FILE.test(context.filename)
    const runnerNamespaces = new Set<string>()

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (source === "@solidjs/testing-library") {
          context.report({ node: node.source, message: MESSAGES.testingLibrary })
          return
        }
        if (source === "solid-js/web") {
          for (const specifier of node.specifiers) {
            if (specifier.type === "ImportSpecifier" && SOLID_MOUNTS.has(importedName(specifier))) {
              context.report({ node: specifier, message: MESSAGES.solidWeb })
            }
          }
          return
        }
        if (!isBrowserTest || !TEST_RUNNERS.has(source)) return
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            runnerNamespaces.add(specifier.local.name)
            continue
          }
          if (specifier.type === "ImportSpecifier" && LIFECYCLE_HOOKS.has(importedName(specifier))) {
            context.report({ node: specifier, message: MESSAGES.lifecycleHook })
          }
        }
      },
      CallExpression(node) {
        if (!isBrowserTest) return
        const callee = unwrapExpression(node.callee)
        if (Option.isNone(callee)) return
        if (callee.value.type === "Identifier" && LIFECYCLE_HOOKS.has(callee.value.name)) {
          context.report({ node: node.callee, message: MESSAGES.lifecycleHook })
          return
        }
        if (
          callee.value.type === "MemberExpression" &&
          callee.value.object.type === "Identifier" &&
          runnerNamespaces.has(callee.value.object.name) &&
          Option.exists(getPropertyName(callee.value.property), (name) => LIFECYCLE_HOOKS.has(name))
        ) {
          context.report({ node: node.callee, message: MESSAGES.lifecycleHook })
        }
      },
    }
  },
})
