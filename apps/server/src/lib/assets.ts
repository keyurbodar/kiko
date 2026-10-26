const IMMUTABLE = "public, max-age=31536000, immutable"

export async function serveAsset(assets: Fetcher, request: Request): Promise<Response> {
  const response = await assets.fetch(request)
  const isHtml = response.headers.get("content-type")?.startsWith("text/html") ?? false
  if (!new URL(request.url).pathname.startsWith("/assets/")) {
    if (!isHtml) return response
    const page = new Response(response.body, response)
    page.headers.set("cache-control", "no-cache")
    return page
  }
  if (isHtml) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } })
  if (!response.ok) return response
  const asset = new Response(response.body, response)
  asset.headers.set("cache-control", IMMUTABLE)
  return asset
}
