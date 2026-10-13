
import type { Env } from "../index"
import type { SessionLookup } from "../router"
import { error, fileKey, filesPath, isFileId, isSpace } from "./upload"

type Span = { start: number; end: number }

export function parseRange(header: string | null, size: number): Span | null | "bad" {
	const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
	// An empty file has no bytes to range over. Serving it whole lets a viewer read a new file.
	if (!m || (m[1] === "" && m[2] === "") || size === 0) return null
	if (m[1] === "") {
		const suffix = Number(m[2])
		if (suffix === 0) return "bad"
		return { start: Math.max(0, size - suffix), end: size - 1 }
	}
	const start = Number(m[1])
	if (m[2] !== "" && Number(m[2]) < start) return null
	if (start >= size) return "bad"
	const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
	return { start, end }
}

function headersFor(object: R2Object): Headers {
	const headers = new Headers()
	object.writeHttpMetadata(headers)
	headers.set("etag", object.httpEtag)
	headers.set("cache-control", "private, max-age=31536000, immutable")
	headers.set("accept-ranges", "bytes")
	// A user's HTML or SVG must not run as kiko's origin.
	headers.set("x-content-type-options", "nosniff")
	headers.set("content-security-policy", "sandbox")
	return headers
}

export async function downloadRoute(
	request: Request,
	env: Env,
	lookup: SessionLookup,
): Promise<Response | null> {
	if (request.method !== "GET" && request.method !== "HEAD") return null
	const route = filesPath(new URL(request.url).pathname)
	if (!route) return null
	const user = await lookup(request, env)
	if (!user) return error(401, "unauthorized")
	const [fileId = "", ...extra] = route.rest
	if (!isSpace(route.roomId) || !isFileId(fileId) || extra.length) return error(404, "not found")
	const key = fileKey(user.id, route.roomId, fileId)

	const head = await env.FILES.head(key)
	if (!head) return error(404, "not found")
	const headers = headersFor(head)
	const span = parseRange(request.headers.get("range"), head.size)
	if (span === "bad") {
		headers.set("content-range", `bytes */${head.size}`)
		return new Response(null, { status: 416, headers })
	}
	const length = span ? span.end - span.start + 1 : head.size
	headers.set("content-length", String(length))
	if (span) headers.set("content-range", `bytes ${span.start}-${span.end}/${head.size}`)
	const status = span ? 206 : 200
	if (request.method === "HEAD") return new Response(null, { status, headers })

	const object = await env.FILES.get(key, span ? { range: { offset: span.start, length } } : {})
	if (!object || !("body" in object)) return error(404, "not found")
	return new Response(object.body, { status, headers })
}
