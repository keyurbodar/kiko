import { describe, expect, test } from "bun:test"
import { type BackendBuild, type Build, backendSkew, type Skew } from "./version-skew"

// Each row: a name, the client, the backend's answer, and the one result that must come out.
const rows: [string, Build, BackendBuild, Skew][] = [
	["the same build", { version: "0.1.0", protocol: 1 }, { version: "0.1.0", protocol: 1 }, "ok"],
	["a newer backend", { version: "0.1.0", protocol: 1 }, { version: "0.2.0", protocol: 1 }, "ok"],
	["one protocol behind is still served", { version: "0.1.0", protocol: 2 }, { version: "0.1.0", protocol: 1 }, "ok"],
	["an older patch", { version: "0.1.1", protocol: 1 }, { version: "0.1.0", protocol: 1 }, "update"],
	["an older minor", { version: "0.2.0", protocol: 1 }, { version: "0.1.9", protocol: 1 }, "update"],
	["minor compares as a number, not text", { version: "0.10.0", protocol: 1 }, { version: "0.9.0", protocol: 1 }, "update"],
	["a pre-release of the same core is not older", { version: "0.1.0", protocol: 1 }, { version: "0.1.0-rc.1", protocol: 1 }, "ok"],
	["a backend with no fields is update", { version: "0.1.0", protocol: 1 }, {}, "update"],
	["a backend with a version but no protocol is update", { version: "0.1.0", protocol: 1 }, { version: "0.1.0" }, "update"],
	["a backend with a protocol but no version is update", { version: "0.1.0", protocol: 1 }, { protocol: 1 }, "update"],
	["two protocols behind is blocked", { version: "0.1.0", protocol: 3 }, { version: "0.1.0", protocol: 1 }, "blocked"],
	["blocked wins over an older version", { version: "0.1.0", protocol: 3 }, { version: "0.0.1", protocol: 0 }, "blocked"],
]

describe("backendSkew", () => {
	for (const [name, client, backend, want] of rows) {
		test(name, () => {
			expect(backendSkew(client, backend)).toBe(want)
		})
	}
})
