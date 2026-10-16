import type { PendingAttachment } from "@kiko/protocol"
import { createStore, produce } from "solid-js/store"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { apiFetch, apiUrl, getToken } from "../lib/api"

/*
 * Composer attachments upload the moment they are picked, as t3code's do (architecture section
 * 18.1, its `attachmentUploadQueue.ts`). Each lands in the room as a pending upload under an id this
 * queue chose, and the send names those ids; the room claims them as it stores the message. Three
 * upload at once, over XHR so the strip can show progress in 5% steps, and a request gives up after
 * five minutes. A failed upload waits for a retry: the button on its thumbnail, or the room's socket
 * opening again. Removing an attachment, or discarding the draft, cancels its upload and deletes
 * what reached the server; a sweep on the server is the backstop.
 *
 * A file up to the server's one-request limit goes in one PUT. A larger one goes in parts, as R2
 * requires: every part but the last is the same size and at least 5 MiB.
 */

export type UploadState =
  | { status: "uploading"; progress: number }
  | { status: "ready"; pendingId: string }
  | { status: "failed"; reason: string }

const MAX_UPLOADS = 3
const OFFLINE = "Not connected"
const TIMEOUT_MS = 5 * 60_000
/** The server's largest single request body (`files/upload.ts`). */
const MAX_SINGLE_PUT = 32 * 1024 * 1024
const PART_BYTES = 16 * 1024 * 1024

type Job = {
  /** The composer's attachment id. */
  id: string
  roomId: string
  file: Blob
  name: string
  type: string
  /** Chosen once per job, so a retry writes over its own earlier try. */
  pendingId: string
  cancelled: boolean
  abort: (() => void) | null
  /** True once a request for this id may have reached the server. */
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

/** The upload state of one composer attachment, tracked. */
export function uploadState(id: string): UploadState | undefined {
  return uploads[id]
}

/** One request. Resolves with the body, rejects with the reason a thumbnail's tooltip shows. */
function request(job: Job, method: string, url: string, body: Blob | string | null, headers: Record<string, string>, onProgress?: (loaded: number) => void): Promise<string> {
  const xhr = new XMLHttpRequest()
  const done = new Promise<string>((resolve, reject) => {
    xhr.open(method, apiUrl(url), true)
    const token = getToken()
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`)
    xhr.timeout = TIMEOUT_MS
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    if (onProgress) xhr.upload.addEventListener("progress", (e) => e.lengthComputable && onProgress(e.loaded))
    xhr.addEventListener("load", () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(`Upload rejected (${xhr.status})`))))
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
    // Quantised to 5%, so a fast upload does not redraw the strip on every packet.
    const step = Math.floor((Math.min(loaded, total) / Math.max(1, total)) * 20)
    if (step === lastStep || job.cancelled) return
    lastStep = step
    set(job.id, { status: "uploading", progress: step / 20 })
  }
  if (total <= MAX_SINGLE_PUT) {
    const query = new URLSearchParams({ name: job.name, size: String(total) })
    await request(job, "PUT", `${base(job)}?${query}`, job.file, { "content-type": job.type }, progress)
    return
  }
  const json = { "content-type": "application/json" }
  const { uploadId } = JSON.parse(await request(job, "POST", `${base(job)}/parts`, JSON.stringify({ name: job.name, type: job.type, size: total }), json)) as { uploadId: string }
  const parts: unknown[] = []
  const at = (rest: string) => `${base(job)}${rest}?uploadId=${encodeURIComponent(uploadId)}`
  for (let n = 1, from = 0; from < total; n++, from += PART_BYTES) {
    if (job.cancelled) throw new Error("Upload cancelled")
    const offset = from
    parts.push(JSON.parse(await request(job, "PUT", at(`/parts/${n}`), job.file.slice(from, from + PART_BYTES), {}, (loaded) => progress(offset + loaded))))
  }
  await request(job, "POST", at("/complete"), JSON.stringify({ parts }), json)
}

async function run(job: Job): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(OFFLINE)
  await transfer(job)
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
          if (reason !== OFFLINE) showToastV2({ title: `Could not upload ${job.name}`, description: reason, variant: "error" })
        },
      )
      .finally(() => {
        job.abort = null
        active--
        pump()
      })
  }
}

/** Deletes a pending upload on the server. Only ever a pending id: the server refuses any other. */
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

/** Starts uploading a composer attachment to `roomId` as pending. A second call for the same id does nothing. */
export function startUpload(id: string, roomId: string, file: Blob, name: string, type: string): void {
  if (jobs.has(id)) return
  const job: Job = { id, roomId, file, name, type, pendingId: newId(), cancelled: false, abort: null, sent: false }
  jobs.set(id, job)
  queue.push(job)
  set(id, { status: "uploading", progress: 0 })
  pump()
}

/** Uploads a failed attachment again under the same pending id. */
export function retryUpload(id: string): void {
  const old = jobs.get(id)
  if (!old || uploads[id]?.status !== "failed") return
  const job: Job = { ...old, cancelled: false, abort: null }
  jobs.set(id, job)
  queue.push(job)
  set(id, { status: "uploading", progress: 0 })
  pump()
}

/** Retries every failed upload. The room store calls it when its socket opens again. */
export function retryFailedUploads(): void {
  for (const id of jobs.keys()) if (uploads[id]?.status === "failed") retryUpload(id)
}

/** The attachment left the composer unsent: stops its upload and deletes what reached the server. */
export function releaseUpload(id: string): void {
  const job = jobs.get(id)
  jobs.delete(id)
  set(id, undefined)
  if (!job) return
  stop(job)
  deletePending(job)
}

/** The attachment was sent: the room now owns its upload, so the queue forgets it without a delete. */
export function forgetUpload(id: string): void {
  jobs.delete(id)
  set(id, undefined)
}

/** What a send names for these attachments, or null while any is not ready. */
export function readyAttachments(items: readonly { id: string; name: string; type: string; size: number }[]): PendingAttachment[] | null {
  const out: PendingAttachment[] = []
  for (const item of items) {
    const state = uploads[item.id]
    if (state?.status !== "ready") return null
    out.push({ pendingId: state.pendingId, name: item.name, type: item.type, size: item.size })
  }
  return out
}

/** Why the send button waits, in t3code's words, or null when every attachment is ready. */
export function uploadBlockReason(ids: readonly string[], state: (id: string) => UploadState | undefined = uploadState): string | null {
  let pending = 0
  let failed = 0
  for (const id of ids) {
    const s = state(id)
    if (s?.status === "failed") failed++
    else if (s?.status !== "ready") pending++
  }
  if (failed) return failed === 1 ? "Retry or remove the failed attachment" : "Retry or remove the failed attachments"
  if (pending) return pending === 1 ? "Attachment still uploading" : "Attachments still uploading"
  return null
}

/** `42%`. */
export function progressLabel(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  return `${Math.floor(bounded * 100)}%`
}
