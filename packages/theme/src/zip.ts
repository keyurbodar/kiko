// Reads the entries of a .vsix (a zip) that an import needs. Only those entries are inflated, so a
// large package costs nothing beyond its directory. Inflation uses the platform's
// DecompressionStream, so no zip library is needed.

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const MAX_ENTRIES = 5_000
const MAX_RATIO = 200
const MAX_COMMENT = 65_535

export async function readZipEntries(bytes: Uint8Array, wanted: (name: string) => boolean, maxEntryBytes: number): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findDirectoryEnd(view)
  const count = view.getUint16(end + 10, true)
  const directory = view.getUint32(end + 16, true)
  if (count === 0xffff || directory === 0xffffffff) throw new Error("That extension package uses unsupported ZIP64 metadata.")
  if (count > MAX_ENTRIES) throw new Error("That extension package has too many files.")

  const entries = new Map<string, Uint8Array>()
  let offset = directory
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL) throw new Error("That extension package has an invalid ZIP directory.")
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("That extension package has an unsafe file name.")
    if (!wanted(name)) continue
    if (uncompressed > maxEntryBytes) throw new Error("A file in that extension package is too large.")
    if (uncompressed > 0 && (compressed === 0 || uncompressed / compressed > MAX_RATIO)) throw new Error("That extension package has an unsafe compression ratio.")
    entries.set(name, await entryBytes(bytes, view, local, method, compressed, maxEntryBytes))
  }
  return entries
}

function findDirectoryEnd(view: DataView): number {
  const floor = Math.max(0, view.byteLength - 22 - MAX_COMMENT)
  for (let at = view.byteLength - 22; at >= floor; at--) {
    if (view.getUint32(at, true) === EOCD && at + 22 + view.getUint16(at + 20, true) === view.byteLength) return at
  }
  throw new Error("That extension package has no ZIP directory.")
}

async function entryBytes(bytes: Uint8Array, view: DataView, local: number, method: number, compressed: number, maxBytes: number): Promise<Uint8Array> {
  if (view.getUint32(local, true) !== LOCAL) throw new Error("That extension package has an invalid file header.")
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  const data = bytes.subarray(start, start + compressed)
  if (method === 0) return data
  if (method !== 8) throw new Error("That extension package uses an unsupported compression method.")
  const inflated = new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")))
  const out = new Uint8Array(await inflated.arrayBuffer())
  if (out.byteLength > maxBytes) throw new Error("A file in that extension package is too large.")
  return out
}
