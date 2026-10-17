/** Bytes as base64 text, for a tool result that carries an image. One string per 32 kb chunk, so a big screenshot does not overflow the argument list. */
export function encodeBase64(bytes: Uint8Array): string {
	let binary = ""
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary)
}
