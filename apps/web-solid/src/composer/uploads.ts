import type { PendingAttachment } from "@kiko/protocol"
import { createComputed, createRoot, on } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { formatBytes } from "../lib/format"
import { apiFetch, apiUrl, getToken } from "../lib/api"
import { connection } from "../state/connection"

export type UploadState =
  | { status: "uploading"; loaded: number; total: number }
  | { status: "ready"; pendingId: string }
  | { status: "failed"; reason: string }

const MAX_UPLOADS = 3
const OFFLINE = "Not connected"
const TIMEOUT_MS = 5 * 60_000
const MAX_SINGLE_PUT = 32 * 1024 * 1024
const PART_BYTES = 16 * 1024 * 1024
const TOAST_WINDOW_MS = 5000
const PROGRESS_STEPS = 100

type Job = {
  id: string
  roomId: string
  file: Blob
  name: string
  type: string
  pendingId: string
  cancelled: boolean
  abort: (() => void) | null
  sent: boolean
}

const [uploads, setUploads] = createStore<Record<string, UploadState>>({})
const jobs = new Map<string, Job>()
const queue: Job[] = []
let active = 0

const newId = () => crypto.randomUUID()
const base = (job: Job) => `/api/files/${job.roomId}/pending/${job.pendingId}`

function set(id: string, state: UploadState | undefined) {
  setUploads(
    produce((s) => {
      if (state) s[id] = state
      else delete s[id]
    }),
  )
}

export function uploadState(id: string): UploadState | undefined {
  return uploads[id]
}

function refusal(status: number, body: string): string {
  try {
    const said = (JSON.parse(body) as { error?: unknown }).error
    if (typeof said === "string" && said.includes(" ")) return said
  } catch {}
  if (status === 413) return "That file is too large to upload."
  if (status === 401) return "Your session ended. Sign in again, then retry."
  return status >= 500
    ? `Your backend had a problem (${status}). Retry in a moment.`
    : `The upload was refused (${status}).`
}

function request(
  job: Job,
  method: string,
  url: string,
  body: Blob | string | null,
  headers: Record<string, string>,
  onProgress?: (loaded: number) => void,
): Promise<string> {
  const xhr = new XMLHttpRequest()
  const done = new Promise<string>((resolve, reject) => {
    xhr.open(method, apiUrl(url), true)
    const token = getToken()
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`)
    xhr.timeout = TIMEOUT_MS
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    if (onProgress) xhr.upload.addEventListener("progress", (e) => e.lengthComputable && onProgress(e.loaded))
    xhr.addEventListener("load", () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.responseText)
        : reject(new Error(refusal(xhr.status, xhr.responseText))),
    )
    xhr.addEventListener("error", () => reject(new Error("Upload failed")))
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")))
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")))
    job.sent = true
    xhr.send(body)
  })
  job.abort = () => xhr.abort()
  return done
}

async function transfer(job: Job): Promise<void> {
  const total = job.file.size
  let lastStep = -1
  const progress = (loaded: number) => {
    const sent = Math.min(loaded, total)
    const step = Math.floor((sent / Math.max(1, total)) * PROGRESS_STEPS)
    if (step === lastStep || job.cancelled) return
    lastStep = step
    set(job.id, { status: "uploading", loaded: sent, total })
  }
  if (total <= MAX_SINGLE_PUT) {
    const query = new URLSearchParams({ name: job.name, size: String(total) })
    await request(job, "PUT", `${base(job)}?${query}`, job.file, { "content-type": job.type }, progress)
    return
  }
  const json = { "content-type": "application/json" }
  const { uploadId } = JSON.parse(
    await request(
      job,
      "POST",
      `${base(job)}/parts`,
      JSON.stringify({ name: job.name, type: job.type, size: total }),
      json,
    ),
  ) as { uploadId: string }
  const parts: unknown[] = []
  const at = (rest: string) => `${base(job)}${rest}?uploadId=${encodeURIComponent(uploadId)}`
  for (let n = 1, from = 0; from < total; n++, from += PART_BYTES) {
    if (job.cancelled) throw new Error("Upload cancelled")
    const offset = from
    parts.push(
      JSON.parse(
        await request(job, "PUT", at(`/parts/${n}`), job.file.slice(from, from + PART_BYTES), {}, (loaded) =>
          progress(offset + loaded),
        ),
      ),
    )
  }
  await request(job, "POST", at("/complete"), JSON.stringify({ parts }), json)
}

async function run(job: Job): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(OFFLINE)
  await transfer(job)
}

let toasted: { at: number; reason: string } | null = null

function isNewFailure(last: { at: number; reason: string } | null, now: number, reason: string): boolean {
  return !last || last.reason !== reason || now - last.at >= TOAST_WINDOW_MS
}

function failToast(name: string, reason: string) {
  const now = Date.now()
  if (!isNewFailure(toasted, now, reason)) return
  toasted = { at: now, reason }
  showToastV2({ title: `Could not upload ${name}`, description: reason, variant: "error" })
}

function pump() {
  while (active < MAX_UPLOADS && queue.length) {
    const job = queue.shift()!
    if (job.cancelled) continue
    active++
    run(job)
      .then(
        () => !job.cancelled && set(job.id, { status: "ready", pendingId: job.pendingId }),
        (e: unknown) => {
          if (job.cancelled) return
          const reason = e instanceof Error ? e.message : "Upload failed"
          set(job.id, { status: "failed", reason })
          if (reason !== OFFLINE) failToast(job.name, reason)
        },
      )
      .finally(() => {
        job.abort = null
        active--
        pump()
      })
  }
}

function deletePending(job: Job) {
  if (!job.sent) return
  void apiFetch(base(job), { method: "DELETE" }).catch(() => {})
}

function stop(job: Job) {
  job.cancelled = true
  const at = queue.indexOf(job)
  if (at !== -1) queue.splice(at, 1)
  job.abort?.()
}

export function startUpload(id: string, roomId: string, file: Blob, name: string, type: string): void {
  if (jobs.has(id)) return
  const job: Job = { id, roomId, file, name, type, pendingId: newId(), cancelled: false, abort: null, sent: false }
  jobs.set(id, job)
  queue.push(job)
  set(id, { status: "uploading", loaded: 0, total: file.size })
  pump()
}

export function retryUpload(id: string): void {
  const old = jobs.get(id)
  if (!old || uploads[id]?.status !== "failed") return
  const job: Job = { ...old, cancelled: false, abort: null }
  jobs.set(id, job)
  queue.push(job)
  set(id, { status: "uploading", loaded: 0, total: job.file.size })
  pump()
}

function retryFailedUploads(): void {
  for (const id of jobs.keys()) if (uploads[id]?.status === "failed") retryUpload(id)
}

createRoot(() =>
  createComputed(on(connection.connected, (connected) => connected && retryFailedUploads(), { defer: true })),
)

export function releaseUpload(id: string): void {
  const job = jobs.get(id)
  jobs.delete(id)
  set(id, undefined)
  if (!job) return
  stop(job)
  deletePending(job)
}

export function forgetUpload(id: string): void {
  jobs.delete(id)
  set(id, undefined)
}

export function pendingAttachments(
  items: readonly { id: string; name: string; type: string; size: number }[],
): PendingAttachment[] {
  return items.flatMap((item) => {
    const job = jobs.get(item.id)
    return job ? [{ pendingId: job.pendingId, name: item.name, type: item.type, size: item.size }] : []
  })
}

export function uploadsStatus(ids: readonly string[]): UploadState["status"] {
  const states = ids.map((id) => uploads[id]?.status ?? "failed")
  if (states.includes("failed")) return "failed"
  return states.every((status) => status === "ready") ? "ready" : "uploading"
}

export function uploadedFile(id: string): { blob: Blob; name: string; type: string } | undefined {
  const job = jobs.get(id)
  return job && { blob: job.file, name: job.name, type: job.type }
}

export function progressLabel(loaded: number, total: number): string {
  return `${formatBytes(Math.max(0, Math.min(loaded, total)))} of ${formatBytes(total)}`
}

export function progressShare(loaded: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, loaded / total)) : 0
}
