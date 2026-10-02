import { type Fetcher, safeFetch } from "../lib/safe-fetch"

// Copies a third-party preview image into R2 so the client loads it from kiko's origin.
// Architecture section 18.2. The queue consumer that calls this belongs to P8-04.

export const PREVIEW_IMAGE_JOB = "preview-image"
export const IMAGE_PREFIX = "previews/"
const IMAGE_ROUTE = "/api/preview-image/"
// safeFetch cuts a body at 1 MB, so a cut image is refused rather than stored broken.
const MAX_IMAGE_BYTES = 1024 * 1024
// SVG is left out on purpose. It can carry script.
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
])

export interface PreviewImageJob {
  type: typeof PREVIEW_IMAGE_JOB
  /** Hash of `url`. It is the delivery id, so a second delivery writes the same object. */
  hash: string
  url: string
}

export async function imageHash(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** The path the client gets in place of the third-party URL. */
export const imagePath = (hash: string) => `${IMAGE_ROUTE}${hash}`

export async function enqueueImage(queue: Queue, url: string): Promise<string> {
  const hash = await imageHash(url)
  const job: PreviewImageJob = { type: PREVIEW_IMAGE_JOB, hash, url }
  await queue.send(job)
  return imagePath(hash)
}

export function isImageJob(value: unknown): value is PreviewImageJob {
  const job = value as Partial<PreviewImageJob> | null
  return job?.type === PREVIEW_IMAGE_JOB && typeof job.hash === "string" && typeof job.url === "string"
}

/** Safe to run twice: the key is the hash, and a stored image is not fetched again. */
export async function handleImageJob(
  job: PreviewImageJob,
  bucket: R2Bucket,
  fetcher?: Fetcher,
): Promise<"stored" | "exists" | "refused"> {
  if (!/^[0-9a-f]{64}$/.test(job.hash) || (await imageHash(job.url)) !== job.hash) return "refused"
  if (await bucket.head(IMAGE_PREFIX + job.hash)) return "exists"
  const result = await safeFetch(job.url, fetcher)
  if (!result.ok || result.status !== 200 || result.truncated || result.body.byteLength > MAX_IMAGE_BYTES) {
    return "refused"
  }
  const type = result.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!IMAGE_TYPES.has(type)) return "refused"
  await bucket.put(IMAGE_PREFIX + job.hash, result.body, { httpMetadata: { contentType: type } })
  return "stored"
}
