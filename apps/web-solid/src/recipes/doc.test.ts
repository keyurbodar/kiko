import { describe, expect, it } from "vitest"
import { parseDoc, recipeSlugOf, setAgent, setApps, setBody, setTitle, setWhen } from "./doc"

const SAMPLE = `---
name: bad-weather
title: Bad weather alerts
description: Texts you when the forecast turns.
when: Daily at 7:00
tags: [mornings]
apps: [Weather, Google Calendar]
setup:
  - what city are you in?
agent:
  name: Kiko
  handle: kiko
---
Every morning, check the forecast.

Say what to carry.
`

describe("recipe document", () => {
  it("reads title, schedule, apps, agent and body", () => {
    expect(parseDoc(SAMPLE)).toEqual({
      title: "Bad weather alerts",
      when: "Daily at 7:00",
      apps: ["Weather", "Google Calendar"],
      agent: { name: "Kiko", handle: "kiko" },
      body: "Every morning, check the forecast.\n\nSay what to carry.",
    })
  })

  it("returns nothing for a file without front matter", () => {
    expect(parseDoc("just text")).toBeNull()
  })

  it("reads apps written as a block list and an empty list", () => {
    expect(parseDoc("---\ntitle: A\napps:\n  - Gmail\n  - GitHub\n---\nbody")?.apps).toEqual(["Gmail", "GitHub"])
    expect(parseDoc("---\ntitle: A\napps: []\n---\nbody")?.apps).toEqual([])
  })

  it("changes one field and leaves everything else as written", () => {
    const next = setWhen(SAMPLE, "Every Monday at 9:00")
    expect(next).toBe(SAMPLE.replace("when: Daily at 7:00", "when: Every Monday at 9:00"))
  })

  it("keeps multi-line fields when other fields change", () => {
    const next = setTitle(setApps(SAMPLE, ["Gmail"]), "Rain check")
    expect(next).toContain("setup:\n  - what city are you in?")
    expect(parseDoc(next)).toMatchObject({ title: "Rain check", apps: ["Gmail"] })
  })

  it("replaces the agent block and can remove it", () => {
    const next = setAgent(SAMPLE, { name: "Scout", handle: "scout" })
    expect(parseDoc(next)?.agent).toEqual({ name: "Scout", handle: "scout" })
    expect(next).toContain("setup:\n  - what city are you in?")
    expect(parseDoc(setAgent(SAMPLE, null))?.agent).toBeNull()
  })

  it("adds a field that was missing", () => {
    const bare = "---\ntitle: A\n---\nbody\n"
    expect(parseDoc(setApps(bare, ["Gmail"]))?.apps).toEqual(["Gmail"])
  })

  it("replaces the body and keeps the front matter", () => {
    const next = setBody(SAMPLE, "New words.\n\n")
    expect(next.endsWith("---\nNew words.\n")).toBe(true)
    expect(parseDoc(next)?.title).toBe("Bad weather alerts")
  })

  it("quotes values that would break the front matter", () => {
    expect(parseDoc(setTitle(SAMPLE, "Rain: a #1 plan"))?.title).toBe("Rain: a #1 plan")
  })
})

describe("recipe paths", () => {
  it("finds the recipe slug of a RECIPE.md file only", () => {
    expect(recipeSlugOf("recipes/bad-weather/RECIPE.md")).toBe("bad-weather")
    expect(recipeSlugOf("home/recipes/x/RECIPE.md")).toBe("x")
    expect(recipeSlugOf("recipes/x/notes.md")).toBeNull()
    expect(recipeSlugOf("notes/RECIPE.md")).toBeNull()
  })
})
