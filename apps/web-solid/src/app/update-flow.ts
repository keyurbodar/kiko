// The update state one tab shares: the one-click update, what the backend and the front door say now, and the checks.
// The sidebar pill, the composer notice and the Account page all read it. Docs: docs/app-kiko.md "Updates".
import { createSignal } from "solid-js"
import { dismissToastV2, showToastV2, updateToastV2 } from "@kiko/ui/v2/toast-v2"
import { PROTOCOL } from "@kiko/protocol"
import { apiFetch } from "../lib/api"
import { showFailure } from "../lib/errors"
import { useApp } from "../lib/store"
import { checkStall, LATEST_POLL_MS, pillView, reduceUpdate, sent, STALL_MS, stageText, type UpdateProgress } from "../lib/update"
import { APP_VERSION, type BackendBuild, backendSkew, clientBehind, type Skew } from "../lib/version-skew"
import { userChannel } from "../sync/user-channel"
import { hosted } from "./hosted"

const [progress, setProgress] = createSignal<UpdateProgress>(null)
const [latest, setLatest] = createSignal<string | undefined>()
const [fetched, setFetched] = createSignal<BackendBuild | null | undefined>()
export { progress }

/** True when the front door serves a newer client than this tab runs. Always false off the hosted app. */
export const clientIsBehind = () => hosted && clientBehind(APP_VERSION, latest())
/** The backend as the last check saw it, else as the socket's hello said. */
export const backendVersion = () => fetched()?.version ?? useApp.user()?.state.backendVersion
export const currentSkew = (): Skew | undefined => {
	const build = fetched()
	return build ? backendSkew({ version: APP_VERSION, protocol: PROTOCOL }, build) : useApp.user()?.state.skew
}

let toastId: number | undefined
const endToast = () => {
	dismissToastV2(toastId)
	toastId = undefined
}

function set(next: UpdateProgress) {
	setProgress(next)
	const text = stageText(next)
	if (text) {
		const options = { title: text, variant: "loading", persistent: true } as const
		if (toastId === undefined) toastId = showToastV2(options)
		else updateToastV2(toastId, options)
	} else {
		endToast()
		if (next?.stage === "failed") showFailure(next.error ?? "The update failed. Try again.")
	}
}

let wired = false
function wire() {
	if (wired) return
	wired = true
	userChannel.on("update.state", (frame) => set(reduceUpdate(frame)))
	// A restart drops the socket. The reconnect's hello says whether the new code answered.
	userChannel.onOpen(() => {
		if (progress()?.stage !== "restarting") return
		set(null)
		setFetched(undefined)
		showToastV2({ title: "Kiko is updated", variant: "success" })
	})
}

export function startUpdate() {
	wire()
	set(sent(Date.now()))
	if (!userChannel.send({ t: "update.start", version: APP_VERSION })) return set({ stage: "failed", error: "Kiko is offline. Try again when it reconnects." })
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
	if (!was && clientIsBehind()) {
		showToastV2({ title: "A new version of Kiko is ready", description: "Reload to update.", persistent: true, action: { label: "Reload", onClick: () => location.reload() } })
	}
}

let watching = false
/** Checks on focus and every 30 minutes. It never reloads by itself. */
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
