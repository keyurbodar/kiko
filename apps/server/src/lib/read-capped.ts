// Reads a copy of the body, stopping as soon as it passes the cap, so a huge body is never
// held in memory just to find out that it cannot be scanned.
export async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      // The over-cap request is refused, so the original body is not needed. Cancel is not awaited:
      // on a cloned body the reader is one branch of a tee, and waiting on its cancel blocks on the
      // branch no one reads.
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(all)
}
