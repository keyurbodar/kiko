// Whether the backend can serve this client. Pure, so the rule is one table in version-skew.test.ts.
//
// "blocked": the backend's protocol is more than one behind the client's. The client cannot read it.
// "update": the backend is older in any way, or it is too old to say (no version or protocol).
// "ok": otherwise. A newer backend is fine.

// Set by vite.config.ts at build time. Tests run without the define, so they read 0.0.0.
declare const __KIKO_VERSION__: string | undefined
export const APP_VERSION: string = typeof __KIKO_VERSION__ === "string" ? __KIKO_VERSION__ : "0.0.0"

export type Skew = "ok" | "update" | "blocked"
export type Build = { version: string; protocol: number }
/** What an older backend may leave out. A missing field means "update". */
export type BackendBuild = { version?: string; protocol?: number }

/** The major, minor, and patch numbers of a semver string. Pre-release and build tags are ignored. */
const core = (version: string) => (version.split(/[-+]/)[0] ?? "").split(".").map(Number)

function olderThan(backend: string, client: string): boolean {
	const a = core(backend)
	const b = core(client)
	for (let i = 0; i < 3; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0)
		if (d !== 0) return d < 0
	}
	return false
}

/** True when the front door serves a newer client than the one this tab runs. */
export const clientBehind = (client: string, latest: string | undefined): boolean => latest !== undefined && olderThan(client, latest)

export function backendSkew(client: Build, backend: BackendBuild): Skew {
	if (backend.version === undefined || backend.protocol === undefined) return "update"
	if (backend.protocol < client.protocol - 1) return "blocked"
	return olderThan(backend.version, client.version) ? "update" : "ok"
}
