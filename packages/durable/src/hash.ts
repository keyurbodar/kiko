/** Lowercase hex of raw bytes. */
export function toHex(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** SHA-256 of text (as UTF-8) or bytes, as lowercase hex. */
export async function sha256Hex(data: string | BufferSource): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
  return toHex(await crypto.subtle.digest("SHA-256", bytes))
}

/** SHA-256 of a stream, hashed natively as it is read. Workers runtime only. */
export async function sha256Stream(stream: ReadableStream): Promise<string> {
  const digest = new crypto.DigestStream("SHA-256")
  await stream.pipeTo(digest)
  return toHex(await digest.digest)
}
