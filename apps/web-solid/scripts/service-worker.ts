interface WorkerEvent extends Event {
  waitUntil(work: Promise<unknown>): void
}

interface WorkerFetchEvent extends WorkerEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

interface WorkerMessageEvent extends WorkerEvent {
  readonly data: unknown
}

interface Manifest {
  assets: string[]
  precache: string[]
}

const scope = self as unknown as {
  location: Location
  registration: { unregister(): Promise<boolean> }
  clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: string, listener: (event: never) => void): void
}

const CACHE = "kiko-assets-v1"
const CONCURRENCY = 3
let running: Promise<void> | null = null
let disabled = false

const isHtml = (response: Response) => (response.headers.get("content-type") ?? "").includes("text/html")

async function purge(): Promise<void> {
  disabled = true
  await Promise.all((await caches.keys()).map((name) => caches.delete(name)))
  await scope.registration.unregister()
}

async function killed(): Promise<boolean> {
  try {
    const response = await fetch("/sw-off", { cache: "no-store" })
    return response.ok && !isHtml(response)
  } catch {
    return false
  }
}

async function activate(): Promise<void> {
  if (await killed()) return purge()
  await Promise.all((await caches.keys()).filter((name) => name !== CACHE).map((name) => caches.delete(name)))
  await scope.clients.claim()
}

async function download(cache: Cache, urls: string[]): Promise<void> {
  const queue = [...urls]
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const response = await fetch(url, { priority: "low" })
        if (response.ok && !isHtml(response)) await cache.put(url, response)
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

async function sync(precache: boolean): Promise<void> {
  if (await killed()) return purge()
  let response: Response
  try {
    response = await fetch("/sw-manifest.json", { cache: "no-store" })
  } catch {
    return
  }
  if (response.status === 404 || (response.ok && isHtml(response))) return purge()
  if (!response.ok) return
  const manifest = (await response.json()) as Manifest
  const cache = await caches.open(CACHE)
  const known = new Set(manifest.assets)
  for (const request of await cache.keys()) {
    if (!known.has(new URL(request.url).pathname)) await cache.delete(request)
  }
  if (!precache) return
  const missing: string[] = []
  for (const url of manifest.precache) {
    if (!(await cache.match(url))) missing.push(url)
  }
  await download(cache, missing)
}

async function assetResponse(event: WorkerFetchEvent): Promise<Response> {
  const request = event.request
  const refresh = request.cache === "reload" || request.cache === "no-store" || request.cache === "no-cache"
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE)
    const hit = refresh ? undefined : await cache.match(request, { ignoreVary: true })
    if (hit) return hit
  } catch {}
  const response = await fetch(request)
  if (cache && response.ok && !isHtml(response)) event.waitUntil(cache.put(request, response.clone()).catch(() => {}))
  return response
}

scope.addEventListener("install", () => void scope.skipWaiting())

scope.addEventListener("activate", (event: WorkerEvent) => event.waitUntil(activate()))

scope.addEventListener("message", (event: WorkerMessageEvent) => {
  if (disabled || (event.data !== "check" && event.data !== "precache")) return
  running ??= sync(event.data === "precache")
    .catch(() => {})
    .finally(() => {
      running = null
    })
  event.waitUntil(running)
})

scope.addEventListener("fetch", (event: WorkerFetchEvent) => {
  const request = event.request
  if (disabled || request.method !== "GET" || request.headers.has("range")) return
  const url = new URL(request.url)
  if (url.origin !== scope.location.origin || !url.pathname.startsWith("/assets/")) return
  event.respondWith(assetResponse(event))
})
