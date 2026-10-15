import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CLIENT_OUT, clientGenerated, ICONS_OUT, iconsGenerated, SERVER_OUT, serverGenerated } from "../scripts/gen-recipes"
import { iconFor, pickIcon } from "../src/recipes/icons"
import { parseRecipe } from "../src/recipes/recipe"

const md = (front: string, body = "do the thing") => `---\n${front}\n---\n${body}`
const base = "title: Tea time\ndescription: A cup at four.\nwhen: Daily at 4:00"

test("a recipe parses its schedule, setup, and agent, with defaults from its name", () => {
  const r = parseRecipe(md(`${base}\ntags: [health]\ntriggers:\n  - every: FREQ=DAILY;BYHOUR=16;BYMINUTE=0\n    run: say tea time\nsetup: [green or black?]`), "tea-time")
  expect([r.slug, r.triggers, r.setup, r.agent]).toEqual(["tea-time", [{ name: "Tea time", every: "FREQ=DAILY;BYHOUR=16;BYMINUTE=0", run: "say tea time" }], ["green or black?"], { name: "Tea time", handle: "tea" }])
})

test("a broken recipe fails with the reason, so the build stops instead of a run", () => {
  expect(() => parseRecipe(md("title: x\nwhen: now"), "x")).toThrow("recipe x: description is required")
  expect(() => parseRecipe(md(`${base}\ntriggers:\n  - every: FREQ=MINUTELY\n    run: spam`), "tea-time")).toThrow("every 30 minutes")
  expect(() => parseRecipe(md(`${base}\ntags: [snacks]`), "tea-time")).toThrow("tag snacks is not one of")
  expect(() => parseRecipe(md(`name: tea-time\n${base}`), "other")).toThrow("must match its folder")
})

test("icons come from the recipe's words, and an unknown topic gets the sparkle", () => {
  expect(pickIcon("Meme machine", "Sends a fitting meme")).toBe("smiley-wink")
  expect(pickIcon("Forward receipts to Ramp", "Forwards receipt emails")).toBe("receipt")
  expect(pickIcon("Apartment hunter", "Watches listings")).toBe("house-line")
  expect(pickIcon("Zorblax", "Qwop the frobnicator")).toBe("sparkle")
})

test("a recipe's own icon wins only when the set has it", () => {
  expect(iconFor("Tea time", "A cup at four.", "cake").icon).toBe("cake")
  expect(iconFor("Morning tea", "A cup at four.", "not-an-icon").icon).toBe("sun-horizon")
})

test("the generated icons and catalogs match apps/server/recipes", async () => {
  expect(readFileSync(ICONS_OUT, "utf8")).toBe(iconsGenerated)
  expect(readFileSync(SERVER_OUT, "utf8")).toBe(serverGenerated)
  expect(readFileSync(CLIENT_OUT, "utf8")).toBe(await clientGenerated())
})
