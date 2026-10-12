import { devRequest } from "../lib/dev-guard"
import { type AuthEnv, OWNER_NAME, signedInResponse } from "./auth"

export const DEV_SESSION_PATH = "/api/auth/dev/session"

// Signs in as a named owner, so each verify suite gets its own objects. Reached only through dev-guard.ts,
// and a development build that reached a deployed or tunneled host still answers as if the route did not exist.
export async function devSessionRoute(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== DEV_SESSION_PATH) return null
  if (!devRequest(url)) return new Response("not found", { status: 404 })
  if (request.method !== "GET" && request.method !== "POST") return Response.json({ message: "method not allowed" }, { status: 405 })

  const input = request.method === "GET" ? { name: url.searchParams.get("name") } : await request.json().catch(() => null)
  const name = (input as { name?: unknown } | null)?.name ?? "dev"
  if (typeof name !== "string" || !OWNER_NAME.test(name)) {
    return Response.json({ message: "name must match [a-z0-9-], 1 to 32 characters" }, { status: 400 })
  }
  const signedIn = await signedInResponse(request, env, name)
  // A browser opens this route with GET, so redirect it to the app with the cookie set.
  if (request.method !== "GET") return signedIn
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": signedIn.headers.get("set-cookie") ?? "" } })
}
