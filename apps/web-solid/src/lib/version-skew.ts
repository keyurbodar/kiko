// Set by vite.config.ts at build time. Tests run without the define, so they read 0.0.0.
declare const __KIKO_VERSION__: string | undefined
export const APP_VERSION: string = typeof __KIKO_VERSION__ === "string" ? __KIKO_VERSION__ : "0.0.0"

export type Skew = "ok" | "update" | "blocked"
export type Build = { version: string; protocol: number }

export type BackendBuild = { version?: string; protocol?: number; storage?: "r2" | "built-in" }

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

export const clientBehind = (client: string, latest: string | undefined): boolean => latest !== undefined && olderThan(client, latest)

export function backendSkew(client: Build, backend: BackendBuild): Skew {
	if (backend.protocol !== client.protocol) return "blocked"
	if (backend.version === undefined) return "update"
	return olderThan(backend.version, client.version) ? "update" : "ok"
}
