export async function serveAsset(assets: Fetcher, request: Request): Promise<Response> {
  const response = await assets.fetch(request)
  const missed = new URL(request.url).pathname.startsWith("/assets/") && response.headers.get("content-type")?.startsWith("text/html")
  return missed ? new Response("not found", { status: 404, headers: { "cache-control": "no-store" } }) : response
}
