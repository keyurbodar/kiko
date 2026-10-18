// The update state one tab shares: the one-click update, what the backend and the front door say now, and the checks.
// The sidebar pill, the composer notice and the Account page all read it.
import { createSignal } from "solid-js"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { PROTOCOL } from "@kiko/protocol"
import { apiFetch } from "../lib/api"
import { showFailure } from "../lib/errors"
import { useApp } from "../lib/store"
import { checkStall, LATEST_POLL_MS, landed, pillView, reduceUpdate, RESTART_ERROR, RESTART_LIMIT_MS, RESTART_POLL_MS, sent, STALL_MS, type UpdateProgress, updateTarget } from "../lib/update"
import { APP_VERSION, type BackendBuild, backendSkew, clientBehind, type Skew } from "../lib/version-skew"
import { userChannel } from "../sync/user-channel"
import { hosted } from "./hosted"

const [progress, setProgress] = createSignal<UpdateProgress>(null)
const [latest, setLatest] = createSignal<string | undefined>()
const [fetched, setFetched] = createSignal<BackendBuild | null | undefined>()
export { progress }

/** True when the front door serves a newer client than this tab runs. Always false off the hosted app. */
export const clientIsBehind = () => hosted && clientBehind(APP_VERSION, latest())
/** Where the backend keeps files. Unknown until the first version check answers. */
export const backendStorage = () => fetched()?.storage

/** The backend as the last check saw it, else as the socket's hello said. */
export const backendVersion = () => fetched()?.version ?? useApp.user()?.state.backendVersion
export const currentSkew = (): Skew | undefined => {
	const build = fetched()
	return build ? backendSkew({ version: APP_VERSION, protocol: PROTOCOL }, build) : useApp.user()?.state.skew
}

// The pill in the sidebar shows each stage. Only the end of an update, or its failure, is a toast.
function set(next: UpdateProgress) {
	setProgress(next)
	if (next?.stage === "failed") showFailure(next.error ?? "The update failed. Try again.")
}

let target = APP_VERSION
let polling = false

/**
 * After the upload, asks the backend for its version until the new one answers. The socket's own reconnect is
 * not waited on: Cloudflare can keep the old socket open, or drop it before the last stage arrives.
 */
async function awaitRestart() {
	if (polling) return
	polling = true
	try {
		for (const until = Date.now() + RESTART_LIMIT_MS; Date.now() < until; await new Promise((r) => setTimeout(r, RESTART_POLL_MS))) {
			const build = await refreshBackend()
			if (!landed(target, build?.version)) continue
			if (clientIsBehind()) return location.reload()
			set(null)
			showToastV2({ title: "Kiko is updated", description: `Now on ${build?.version}.`, variant: "success" })
			return
		}
		set({ stage: "failed", error: RESTART_ERROR })
	} finally {
		polling = false
	}
}

let wired = false
function wire() {
	if (wired) return
	wired = true
	userChannel.on("update.state", (frame) => {
		set(reduceUpdate(frame))
		if (frame.stage === "restarting") void awaitRestart()
	})
	// A drop during the upload can lose the "restarting" frame. The upload may still have landed, so look.
	userChannel.onOpen(() => {
		const stage = progress()?.stage
		if (stage === "uploading" || stage === "restarting") void awaitRestart()
	})
}

/** One click: installs the newest release on the backend, then reloads this tab into it when it is newer too. */
export async function startUpdate() {
	wire()
	target = updateTarget(APP_VERSION, latest())
	set(sent(Date.now()))
	const build = await refreshBackend()
	if (landed(target, build?.version)) {
		if (clientIsBehind()) return location.reload()
		return set(null)
	}
	if (!userChannel.send({ t: "update.start", version: target })) return set({ stage: "failed", error: "Kiko is offline. Try again when it reconnects." })
	setTimeout(() => {
		const p = progress()
		const stalled = checkStall(p, Date.now())
		if (stalled !== p) set(stalled)
	}, STALL_MS)
}

/** Asks the backend for its build. Keeps the last answer when the request fails. */
export async function refreshBackend(): Promise<BackendBuild | null> {
	const res = await apiFetch("/api/version").catch(() => null)
	const build = res?.ok ? ((await res.json().catch(() => null)) as BackendBuild | null) : null
	if (build) setFetched(build)
	return build
}

/** Asks the front door for the newest client. Never cached, or a stale answer would hide a deploy. */
export async function refreshLatest(): Promise<void> {
	if (!hosted) return
	const res = await fetch("/releases/latest.json", { cache: "no-store" }).catch(() => null)
	const body = (res?.ok ? await res.json().catch(() => null) : null) as { version?: unknown } | null
	if (typeof body?.version !== "string") return
	const was = clientIsBehind()
	setLatest(body.version)
	if (!was && clientIsBehind() && !progress()) {
		showToastV2({ title: `Kiko ${body.version} is ready`, description: "Update in one click.", action: { label: "Update", onClick: () => void startUpdate() } })
	}
}

let watching = false
/** Checks on focus, when the tab shows again, and every few minutes. It never reloads by itself. */
export function watchLatest() {
	if (watching || !hosted) return
	watching = true
	void refreshLatest()
	const visible = () => document.visibilityState === "visible" && void refreshLatest()
	window.addEventListener("focus", () => void refreshLatest())
	document.addEventListener("visibilitychange", visible)
	setInterval(() => void refreshLatest(), LATEST_POLL_MS)
}

/** "Check for updates": asks both, then says what it found. */
export async function checkForUpdates(): Promise<void> {
	const [build] = await Promise.all([refreshBackend(), refreshLatest()])
	if (!build) return void showFailure("Could not reach your backend. Try again.")
	if (clientIsBehind() || currentSkew() !== "ok") return void showToastV2({ title: "An update is available", variant: "info" })
	showToastV2({ title: "Kiko is up to date", variant: "success" })
}

/** What the pill, the notice and the Account page show right now. */
export const view = () => pillView(currentSkew(), clientIsBehind(), progress())
