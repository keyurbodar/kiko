// Serves the client's static files. In single-page mode a missing file comes back as index.html with status 200,
// and `_headers` caches everything under /assets/ for a year. A browser that asks for a new chunk while a deploy is
// still spreading would keep that HTML as the chunk for good, and the app would never boot. A miss there is a 404
// that no one caches.
export async function serveAsset(assets: Fetcher, request: Request): Promise<Response> {
  const response = await assets.fetch(request)
  const missed = new URL(request.url).pathname.startsWith("/assets/") && response.headers.get("content-type")?.startsWith("text/html")
  return missed ? new Response("not found", { status: 404, headers: { "cache-control": "no-store" } }) : response
}
