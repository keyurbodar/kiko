import { expect, test } from "bun:test"

// `onIndexChange` is a pure function, but its module also imports the Solid component. Importing
// it here is enough because nothing renders.
import { type IndexChange, onIndexChange } from "./editor"

test("what a new version in the index means for an open file", () => {
	const known = new Set(["v1", "mine"])
	const cases: [string | undefined, boolean, IndexChange][] = [
		[undefined, true, "none"], // the file was removed: the save path reports it
		["v1", false, "none"], // nothing changed
		["mine", false, "none"], // the editor's own save came back as an event
		["theirs", false, "reload"], // an agent wrote and the user has no edits to lose
		["theirs", true, "conflict"], // an agent wrote and the user's text must not be replaced
	]
	for (const [latest, dirty, want] of cases) expect(onIndexChange(known, latest, dirty)).toBe(want)
})
