// Architecture section 24. A user extension is a manifest and a few JavaScript files. The manifest
// says what the extension is and what it may do; the server enforces exactly that. The script
// runs in a QuickJS sandbox inside the agent's object.
//
// This file is pure and has no runtime dependency, so the server, the CLI, and the client's
// editor check a manifest the same way.

/** The manifest format this server reads. A breaking change is a new number. */
export const EXTENSION_SDK = 1

/** What a tool does outside the model's head. The same table as the trust gate's (section 16.3). */
export type ExtensionEffect = "read" | "write" | "message" | "external"
export const EXTENSION_EFFECTS: readonly ExtensionEffect[] = ["read", "write", "message", "external"]

/** The pi-durable hooks an extension may add. `beforeRequest` and `beforeCompact` are kept for kiko. */
export type ExtensionHook = "beforeTool" | "afterTool" | "onYield" | "afterResponse"
export const EXTENSION_HOOKS: readonly ExtensionHook[] = ["beforeTool", "afterTool", "onYield", "afterResponse"]

/** Where `kiko.state` keeps an extension's data. */
export type ExtensionStateScope = "user" | "room" | "agent"

export type ExtensionTool = {
	description: string
	effect: ExtensionEffect
	/** A JSON Schema object for the arguments. Absent means no arguments. */
	parameters?: Record<string, unknown>
}

export type ExtensionSection = {
	/** Static text. Without it the script's `sections[id]` renders the section. */
	text?: string
}

export type ExtensionSecret = {
	/** The only hosts this secret is ever sent to. Each must be in `egress`. */
	hosts: readonly string[]
	description?: string
}

/** Messages the extension's agent on a schedule, as a reminder (section 14). */
export type ExtensionTrigger = {
	id: string
	/** An RFC 5545 rule, such as `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0`. Wall time in the user's zone. */
	rrule: string
	/** What the agent is told. */
	send: string
}

/** One check `extension_check` runs, with the calls and fetches it makes answered by mocks. */
export type ExtensionTest = {
	tool: string
	args?: Record<string, unknown>
	/** What `kiko.call(name)` returns, by tool name. */
	calls?: Record<string, unknown>
	/** What every `kiko.fetch` returns. */
	fetch?: { status?: number; body?: unknown }
	/** The result must contain this text. */
	expect?: string
}

export type ExtensionManifest = {
	kiko: typeof EXTENSION_SDK
	name: string
	version: string
	description: string
	/** The entry module. Default `main.js`. Only read when the extension has script parts. */
	main?: string
	tools?: Record<string, ExtensionTool>
	sections?: Record<string, ExtensionSection>
	hooks?: readonly ExtensionHook[]
	wraps?: { tools?: readonly string[]; sections?: readonly string[] }
	/** The tools the script may call with `kiko.call`. */
	calls?: readonly string[]
	/** The hosts `kiko.fetch` may reach. `*.example.com` covers every subdomain. */
	egress?: readonly string[]
	secrets?: Record<string, ExtensionSecret>
	state?: ExtensionStateScope
	triggers?: readonly ExtensionTrigger[]
	tests?: readonly ExtensionTest[]
}

/** An extension as it travels and is stored: the manifest and every file by path. */
export type ExtensionBundle = {
	manifest: ExtensionManifest
	files: Record<string, string>
}

// ---------------------------------------------------------------------------------------------
// Limits and checks.

export const EXTENSION_LIMITS = {
	files: 16,
	sourceBytes: 256 * 1024,
	tools: 32,
	sections: 8,
	sectionText: 4000,
	description: 400,
	triggers: 8,
	tests: 32,
	egress: 16,
	secrets: 8,
	parametersBytes: 8 * 1024,
} as const

const NAME = /^[a-z][a-z0-9-]{1,31}$/
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9a-z.-]{1,32})?$/
const TOOL = /^[a-z][a-z0-9_]{1,47}$/
const SECTION = /^[a-z][a-z0-9-]{1,31}$/
const SECRET = /^[A-Z][A-Z0-9_]{0,31}$/
const HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const PATH = /^(?:[a-z0-9_-][a-z0-9._-]{0,63}\/){0,3}[a-z0-9_-][a-z0-9._-]{0,63}\.(?:js|mjs|json|md|txt)$/i
const RRULE = /^(?:DTSTART[^\n]*\n)?(?:RRULE:)?FREQ=(?:MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;[A-Z]+=[A-Z0-9,+-]+)*$/

/** The prompt sections an extension may not wrap: the rules that say what untrusted data is. */
export const PROTECTED_SECTIONS: readonly string[] = ["kiko", "reactions", "role"]

/** Every key the manifest format knows. An unknown key is a mistake, never ignored. */
const KEYS = new Set(["$schema", "kiko", "name", "version", "description", "main", "tools", "sections", "hooks", "wraps", "calls", "egress", "secrets", "state", "triggers", "tests"])

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string")
const byteLength = (s: string) => new TextEncoder().encode(s).length

/** True when `host` matches one of `patterns`, where `*.x.y` covers every subdomain of `x.y`. */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
	const h = host.toLowerCase()
	return patterns.some((p) => (p.startsWith("*.") ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p))
}

/** True when the extension has parts the script provides, so it needs an entry module. */
export function needsScript(m: ExtensionManifest): boolean {
	return (
		Object.keys(m.tools ?? {}).length > 0 ||
		Object.values(m.sections ?? {}).some((s) => s.text === undefined) ||
		(m.hooks?.length ?? 0) > 0 ||
		(m.wraps?.tools?.length ?? 0) > 0 ||
		(m.wraps?.sections?.length ?? 0) > 0
	)
}

export type ManifestCheck = { ok: true; manifest: ExtensionManifest } | { ok: false; problems: string[] }

/** Checks a parsed `extension.json`. Every problem is one plain line, so an agent can fix them all at once. */
export function checkManifest(value: unknown): ManifestCheck {
	const problems: string[] = []
	const bad = (line: string) => problems.push(line)
	if (!isObject(value)) return { ok: false, problems: ["the manifest must be a json object"] }
	for (const key of Object.keys(value)) if (!KEYS.has(key)) bad(`unknown key "${key}"`)
	if (value.kiko !== EXTENSION_SDK) bad(`"kiko" must be ${EXTENSION_SDK}`)
	if (typeof value.name !== "string" || !NAME.test(value.name)) bad(`"name" must be 2 to 32 lowercase letters, digits, or dashes, starting with a letter`)
	if (typeof value.version !== "string" || !VERSION.test(value.version)) bad(`"version" must look like 1.0.0`)
	if (typeof value.description !== "string" || !value.description.trim()) bad(`"description" is required`)
	else if (value.description.length > EXTENSION_LIMITS.description) bad(`"description" is longer than ${EXTENSION_LIMITS.description} characters`)
	if (value.main !== undefined && (typeof value.main !== "string" || !PATH.test(value.main) || !/\.m?js$/.test(value.main))) bad(`"main" must be a .js file path`)

	const egress = isStringArray(value.egress) ? value.egress : []
	if (value.egress !== undefined) {
		if (!isStringArray(value.egress)) bad(`"egress" must be a list of host names`)
		else {
			if (value.egress.length > EXTENSION_LIMITS.egress) bad(`"egress" has more than ${EXTENSION_LIMITS.egress} hosts`)
			for (const h of value.egress) if (!HOST.test(h)) bad(`egress host "${h}" is not a lowercase host name such as api.example.com or *.example.com`)
		}
	}

	const tools = value.tools
	const toolNames = new Set<string>()
	if (tools !== undefined) {
		if (!isObject(tools)) bad(`"tools" must be an object of tool name to tool`)
		else {
			const names = Object.keys(tools)
			if (names.length > EXTENSION_LIMITS.tools) bad(`more than ${EXTENSION_LIMITS.tools} tools`)
			for (const name of names) {
				toolNames.add(name)
				const t = tools[name]
				const at = `tool "${name}"`
				if (!TOOL.test(name)) bad(`${at}: the name must be 2 to 48 lowercase letters, digits, or underscores, starting with a letter`)
				if (!isObject(t)) {
					bad(`${at} must be an object`)
					continue
				}
				for (const key of Object.keys(t)) if (!["description", "effect", "parameters"].includes(key)) bad(`${at}: unknown key "${key}"`)
				if (typeof t.description !== "string" || !t.description.trim()) bad(`${at}: "description" is required`)
				if (!EXTENSION_EFFECTS.includes(t.effect as ExtensionEffect)) bad(`${at}: "effect" must be read, write, message, or external`)
				if (t.parameters !== undefined) {
					if (!isObject(t.parameters) || t.parameters.type !== "object") bad(`${at}: "parameters" must be a json schema with "type": "object"`)
					else if (byteLength(JSON.stringify(t.parameters)) > EXTENSION_LIMITS.parametersBytes) bad(`${at}: "parameters" is larger than 8 kb`)
				}
			}
		}
	}

	const sections = value.sections
	if (sections !== undefined) {
		if (!isObject(sections)) bad(`"sections" must be an object of section id to section`)
		else {
			const ids = Object.keys(sections)
			if (ids.length > EXTENSION_LIMITS.sections) bad(`more than ${EXTENSION_LIMITS.sections} sections`)
			for (const id of ids) {
				const s = sections[id]
				const at = `section "${id}"`
				if (!SECTION.test(id)) bad(`${at}: the id must be 2 to 32 lowercase letters, digits, or dashes`)
				if (!isObject(s)) {
					bad(`${at} must be an object, such as {} or { "text": "..." }`)
					continue
				}
				for (const key of Object.keys(s)) if (key !== "text") bad(`${at}: unknown key "${key}"`)
				if (s.text !== undefined && (typeof s.text !== "string" || s.text.length > EXTENSION_LIMITS.sectionText)) bad(`${at}: "text" must be text of at most ${EXTENSION_LIMITS.sectionText} characters`)
			}
		}
	}

	if (value.hooks !== undefined) {
		if (!isStringArray(value.hooks)) bad(`"hooks" must be a list`)
		else
			for (const h of value.hooks)
				if (!EXTENSION_HOOKS.includes(h as ExtensionHook)) bad(`hook "${h}" is not one of ${EXTENSION_HOOKS.join(", ")}`)
	}

	if (value.wraps !== undefined) {
		const w = value.wraps
		if (!isObject(w)) bad(`"wraps" must be { "tools": [...], "sections": [...] }`)
		else {
			for (const key of Object.keys(w)) if (key !== "tools" && key !== "sections") bad(`wraps: unknown key "${key}"`)
			if (w.tools !== undefined && !isStringArray(w.tools)) bad(`"wraps.tools" must be a list of tool names`)
			if (isStringArray(w.tools)) for (const t of w.tools) if (toolNames.has(t)) bad(`wraps: "${t}" is this extension's own tool; change it in the script instead`)
			if (w.sections !== undefined && !isStringArray(w.sections)) bad(`"wraps.sections" must be a list of section keys`)
			if (isStringArray(w.sections)) for (const s of w.sections) if (PROTECTED_SECTIONS.includes(s)) bad(`wraps: section "${s}" holds kiko's safety rules and cannot be wrapped`)
		}
	}

	if (value.calls !== undefined) {
		if (!isStringArray(value.calls)) bad(`"calls" must be a list of tool names`)
		else for (const c of value.calls) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(c)) bad(`calls: "${c}" is not a tool name`)
	}

	if (value.secrets !== undefined) {
		if (!isObject(value.secrets)) bad(`"secrets" must be an object of secret name to { "hosts": [...] }`)
		else {
			const names = Object.keys(value.secrets)
			if (names.length > EXTENSION_LIMITS.secrets) bad(`more than ${EXTENSION_LIMITS.secrets} secrets`)
			for (const name of names) {
				const s = value.secrets[name]
				const at = `secret "${name}"`
				if (!SECRET.test(name)) bad(`${at}: the name must be uppercase letters, digits, or underscores, such as API_KEY`)
				if (!isObject(s) || !isStringArray(s.hosts) || s.hosts.length === 0) {
					bad(`${at}: "hosts" must list the hosts it is sent to`)
					continue
				}
				for (const key of Object.keys(s)) if (key !== "hosts" && key !== "description") bad(`${at}: unknown key "${key}"`)
				for (const h of s.hosts) if (!egress.includes(h)) bad(`${at}: host "${h}" must also be in "egress"`)
				if (s.description !== undefined && typeof s.description !== "string") bad(`${at}: "description" must be text`)
			}
		}
	}

	if (value.state !== undefined && !["user", "room", "agent"].includes(value.state as string)) bad(`"state" must be user, room, or agent`)

	if (value.triggers !== undefined) {
		if (!Array.isArray(value.triggers)) bad(`"triggers" must be a list`)
		else {
			if (value.triggers.length > EXTENSION_LIMITS.triggers) bad(`more than ${EXTENSION_LIMITS.triggers} triggers`)
			const seen = new Set<string>()
			for (const [i, t] of value.triggers.entries()) {
				const at = `trigger ${i + 1}`
				if (!isObject(t)) {
					bad(`${at} must be an object`)
					continue
				}
				if (typeof t.id !== "string" || !SECTION.test(t.id)) bad(`${at}: "id" must be 2 to 32 lowercase letters, digits, or dashes`)
				else if (seen.has(t.id)) bad(`${at}: id "${t.id}" is used twice`)
				else seen.add(t.id)
				if (typeof t.rrule !== "string" || !RRULE.test(t.rrule.trim())) bad(`${at}: "rrule" must be a recurrence rule such as FREQ=DAILY;BYHOUR=9;BYMINUTE=0`)
				else if (/FREQ=MINUTELY/.test(t.rrule)) bad(`${at}: a trigger fires at most once an hour`)
				if (typeof t.send !== "string" || !t.send.trim() || t.send.length > 500) bad(`${at}: "send" must be text of at most 500 characters`)
			}
		}
	}

	if (value.tests !== undefined) {
		if (!Array.isArray(value.tests)) bad(`"tests" must be a list`)
		else {
			if (value.tests.length > EXTENSION_LIMITS.tests) bad(`more than ${EXTENSION_LIMITS.tests} tests`)
			for (const [i, t] of value.tests.entries()) {
				const at = `test ${i + 1}`
				if (!isObject(t) || typeof t.tool !== "string") bad(`${at}: "tool" is required`)
				else if (!toolNames.has(t.tool)) bad(`${at}: tool "${t.tool}" is not in "tools"`)
				if (isObject(t) && t.args !== undefined && !isObject(t.args)) bad(`${at}: "args" must be an object`)
				if (isObject(t) && t.calls !== undefined && !isObject(t.calls)) bad(`${at}: "calls" must be an object of tool name to result`)
				if (isObject(t) && t.fetch !== undefined && !isObject(t.fetch)) bad(`${at}: "fetch" must be { "status": 200, "body": ... }`)
				if (isObject(t) && t.expect !== undefined && typeof t.expect !== "string") bad(`${at}: "expect" must be text`)
			}
		}
	}

	return problems.length ? { ok: false, problems } : { ok: true, manifest: value as unknown as ExtensionManifest }
}

export type BundleCheck = { ok: true; bundle: ExtensionBundle } | { ok: false; problems: string[] }

/** Checks a whole bundle: the manifest, the files, and that the entry module exists when it is needed. */
export function checkBundle(value: unknown): BundleCheck {
	if (!isObject(value)) return { ok: false, problems: ["the bundle must be { manifest, files }"] }
	const m = checkManifest(value.manifest)
	const problems = m.ok ? [] : [...m.problems]
	const files = value.files
	if (!isObject(files)) problems.push(`"files" must be an object of path to text`)
	else {
		const paths = Object.keys(files)
		if (paths.length > EXTENSION_LIMITS.files) problems.push(`more than ${EXTENSION_LIMITS.files} files`)
		let bytes = 0
		for (const p of paths) {
			if (!PATH.test(p) || p.split("/").some((s) => s === "." || s === "..")) problems.push(`file "${p}": only plain relative paths such as lib/util.js`)
			if (typeof files[p] !== "string") problems.push(`file "${p}" must be text`)
			else bytes += byteLength(files[p] as string)
		}
		if (bytes > EXTENSION_LIMITS.sourceBytes) problems.push(`the files are larger than ${EXTENSION_LIMITS.sourceBytes / 1024} kb`)
		if (m.ok && needsScript(m.manifest)) {
			const main = m.manifest.main ?? "main.js"
			if (typeof files[main] !== "string") problems.push(`the entry module "${main}" is missing`)
		}
	}
	return problems.length ? { ok: false, problems } : { ok: true, bundle: { manifest: m.ok ? m.manifest : (value.manifest as ExtensionManifest), files: files as Record<string, string> } }
}

// ---------------------------------------------------------------------------------------------
// The review: what an extension can do, in plain lowercase lines, for the install card.

const EFFECT_WORDS: Record<ExtensionEffect, string> = {
	read: "only reads",
	write: "changes things in kiko",
	message: "messages your agents",
	external: "acts outside kiko",
}

const HOOK_WORDS: Record<ExtensionHook, string> = {
	beforeTool: "can block or change any tool call before it runs",
	afterTool: "can change any tool result",
	onYield: "can make the agent keep working after it answers",
	afterResponse: "sees every reply the model writes",
}

export type ReviewLine = { text: string; level: "info" | "notice" | "warning" }

/** Every power the manifest asks for, one line each, the riskiest marked. */
export function describeManifest(m: ExtensionManifest): ReviewLine[] {
	const lines: ReviewLine[] = []
	for (const [name, t] of Object.entries(m.tools ?? {})) {
		lines.push({ text: `adds tool ${name}: ${EFFECT_WORDS[t.effect]}`, level: t.effect === "external" ? "warning" : t.effect === "read" ? "info" : "notice" })
	}
	for (const [id, s] of Object.entries(m.sections ?? {})) lines.push({ text: `adds "${id}" to the agent's instructions${s.text === undefined ? ", written by its script" : ""}`, level: "notice" })
	for (const h of m.hooks ?? []) lines.push({ text: HOOK_WORDS[h], level: h === "beforeTool" || h === "afterTool" || h === "onYield" ? "warning" : "notice" })
	for (const t of m.wraps?.tools ?? []) lines.push({ text: `changes how ${t} works`, level: "warning" })
	for (const s of m.wraps?.sections ?? []) lines.push({ text: `rewrites the "${s}" part of the agent's instructions`, level: "warning" })
	if (m.calls?.length) lines.push({ text: `calls your tools: ${m.calls.join(", ")}`, level: "notice" })
	if (m.egress?.length) {
		const sends = Object.values(m.tools ?? {}).some((t) => t.effect === "external")
		lines.push({ text: `${sends ? "can read from and send to" : "can read from"} ${m.egress.join(", ")}`, level: "warning" })
	}
	for (const [name, s] of Object.entries(m.secrets ?? {})) lines.push({ text: `uses your secret ${name}, sent only to ${s.hosts.join(", ")}`, level: "notice" })
	if (m.state) lines.push({ text: `keeps its own notes ${m.state === "user" ? "across all chats" : m.state === "room" ? "per chat" : "per agent"}`, level: "info" })
	for (const t of m.triggers ?? []) lines.push({ text: `messages the agent on a schedule (${t.rrule}): "${t.send}"`, level: "notice" })
	if (!lines.length) lines.push({ text: "changes nothing yet", level: "info" })
	return lines
}
