import { describe, expect, test } from "bun:test"
import { checkBundle, checkManifest, describeManifest, hostAllowed, needsScript } from "../src/extensions"
import { ExtensionBundle } from "../src/schema"
import * as Schema from "effect/Schema"

const standup = {
	kiko: 1,
	name: "standup",
	version: "1.2.0",
	description: "daily standup to slack",
	tools: { standup_post: { description: "post it", effect: "external", parameters: { type: "object", properties: { extra: { type: "string" } } } } },
	sections: { standup: { text: "say standup to post." }, live: {} },
	hooks: ["beforeTool"],
	calls: ["list_tasks"],
	egress: ["hooks.slack.com", "*.example.com"],
	secrets: { SLACK_HOOK: { hosts: ["hooks.slack.com"] } },
	state: "room",
	triggers: [{ id: "morning", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0", send: "time for standup." }],
	tests: [{ tool: "standup_post", expect: "posted" }],
}

describe("checkManifest", () => {
	test("accepts a manifest that uses every part", () => {
		expect(checkManifest(standup)).toEqual({ ok: true, manifest: standup as never })
	})

	test("names every problem at once", () => {
		const out = checkManifest({ ...standup, name: "Bad Name", version: "one", tools: { "Bad-Tool": { description: "", effect: "maybe" } }, extra: 1 })
		expect(out.ok).toBe(false)
		const problems = out.ok ? [] : out.problems
		expect(problems).toContain('unknown key "extra"')
		expect(problems.some((p) => p.startsWith('"name"'))).toBe(true)
		expect(problems.some((p) => p.startsWith('"version"'))).toBe(true)
		expect(problems.some((p) => p.includes('tool "Bad-Tool": the name'))).toBe(true)
		expect(problems.some((p) => p.includes('"effect" must be'))).toBe(true)
		// The test names a tool that no longer exists.
		expect(problems.some((p) => p.includes('tool "standup_post" is not in "tools"'))).toBe(true)
	})

	test("a secret may only go to hosts the extension can reach", () => {
		const out = checkManifest({ ...standup, secrets: { KEY: { hosts: ["evil.test"] } } })
		expect(out.ok ? [] : out.problems).toContain('secret "KEY": host "evil.test" must also be in "egress"')
	})

	test("the safety sections cannot be wrapped", () => {
		for (const s of ["kiko", "reactions", "role"]) {
			const out = checkManifest({ ...standup, wraps: { sections: [s] } })
			expect(out.ok).toBe(false)
		}
		expect(checkManifest({ ...standup, wraps: { sections: ["soul"] } }).ok).toBe(true)
	})

	test("refuses ip literals and bare names as egress hosts", () => {
		for (const h of ["127.0.0.1", "localhost", "HTTP://x.com", "x.com/path"]) expect(checkManifest({ ...standup, egress: [h], secrets: undefined }).ok).toBe(false)
	})

	test("refuses a trigger that fires every minute", () => {
		const out = checkManifest({ ...standup, triggers: [{ id: "spam", rrule: "FREQ=MINUTELY", send: "hi" }] })
		expect(out.ok).toBe(false)
	})
})

describe("checkBundle", () => {
	test("needs the entry module only when the extension has script parts", () => {
		const prompt = { kiko: 1, name: "voice", version: "1.0.0", description: "a house style", sections: { voice: { text: "write short." } } }
		expect(needsScript(prompt as never)).toBe(false)
		expect(checkBundle({ manifest: prompt, files: {} }).ok).toBe(true)
		const missing = checkBundle({ manifest: standup, files: {} })
		expect(missing.ok ? [] : missing.problems).toContain('the entry module "main.js" is missing')
	})

	test("refuses paths that climb out of the bundle", () => {
		const out = checkBundle({ manifest: standup, files: { "main.js": "", "../x.js": "" } })
		expect(out.ok).toBe(false)
	})

	test("the wire schema accepts exactly what checkBundle accepts", () => {
		const is = Schema.is(ExtensionBundle)
		expect(is({ manifest: standup, files: { "main.js": "export const tools = {}" } })).toBe(true)
		expect(is({ manifest: { ...standup, name: "X" }, files: { "main.js": "" } })).toBe(false)
	})
})

test("hostAllowed matches subdomains only through a wildcard", () => {
	expect(hostAllowed("hooks.slack.com", ["hooks.slack.com"])).toBe(true)
	expect(hostAllowed("evil.hooks.slack.com", ["hooks.slack.com"])).toBe(false)
	expect(hostAllowed("a.example.com", ["*.example.com"])).toBe(true)
	expect(hostAllowed("example.com", ["*.example.com"])).toBe(false)
	expect(hostAllowed("badexample.com", ["*.example.com"])).toBe(false)
})

test("the review marks the risky powers", () => {
	const lines = describeManifest(standup as never)
	expect(lines.find((l) => l.text.startsWith("adds tool standup_post"))?.level).toBe("warning")
	expect(lines.find((l) => l.text.startsWith("can read from and send to"))?.level).toBe("warning")
	expect(lines.find((l) => l.text.includes("block or change"))?.level).toBe("warning")
	expect(lines.every((l) => l.text === l.text.toLowerCase() || /[A-Z_]{3,}/.test(l.text))).toBe(true)
})
