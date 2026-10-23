import { describe } from "@effect/vitest"

import { createOxlintRuleHarness } from "../test/utils.ts"

const browserTest = createOxlintRuleHarness("kiko/require-disposable-render", {
  filename: "Widget.browser.test.tsx",
})
const unitTest = createOxlintRuleHarness("kiko/require-disposable-render", {
  filename: "widget.test.tsx",
})

describe("kiko/require-disposable-render", () => {
  browserTest.valid(
    "allows the disposable helper",
    [
      'import { render } from "../test/render";',
      'import { userEvent } from "vitest/browser";',
      'import { createRoot } from "solid-js";',
      'it("renders", async () => {',
      "  await using screen = await render(() => null);",
      '  await userEvent.click(screen.getByRole("button"));',
      "});",
    ].join("\n"),
  )
  browserTest.invalid(
    "rejects rendering through the testing library directly",
    'import { render } from "@solidjs/testing-library";',
  )
  browserTest.invalid("rejects the testing library's cleanup", 'import { cleanup } from "@solidjs/testing-library";')
  browserTest.invalid("rejects a hand-mounted Solid root", 'import { render } from "solid-js/web";')
  browserTest.invalid("rejects a renamed hand-mounted Solid root", 'import { render as mount } from "solid-js/web";')
  browserTest.valid("allows other solid-js/web exports", 'import { Portal } from "solid-js/web";')
  browserTest.invalid(
    "rejects lifecycle hooks through a test runner namespace",
    ['import * as vt from "vitest";', "vt.beforeEach(() => {});"].join("\n"),
  )
  browserTest.invalid(
    "rejects importing lifecycle hooks from the test runner",
    'import { beforeEach, it } from "vitest";',
  )
  browserTest.invalid("rejects afterEach", "afterEach(async () => {});")
  browserTest.invalid("rejects beforeAll", "beforeAll(() => {});")
  unitTest.valid("allows lifecycle hooks outside browser tests", "beforeEach(() => {});")
  unitTest.valid("allows importing lifecycle hooks outside browser tests", 'import { afterEach } from "vitest";')
  unitTest.invalid("still rejects a hand-mounted Solid root in unit tests", 'import { render } from "solid-js/web";')
})
