// Builds a small zip for tests. Entries are deflated with the platform's CompressionStream, the
// same format a .vsix uses. Checksums stay zero because the reader does not check them.

export type ZipInput = { name: string; data: string | Uint8Array; deflate?: boolean }

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function zipOf(inputs: ZipInput[]): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const input of inputs) {
    const name = encoder.encode(input.name)
    const raw = typeof input.data === "string" ? encoder.encode(input.data) : input.data
    const body = input.deflate ? await deflateRaw(raw) : raw
    const method = input.deflate ? 8 : 0

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(8, method, true)
    local.setUint32(18, body.byteLength, true)
    local.setUint32(22, raw.byteLength, true)
    local.setUint16(26, name.byteLength, true)
    parts.push(new Uint8Array(local.buffer), name, body)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(10, method, true)
    dir.setUint32(20, body.byteLength, true)
    dir.setUint32(24, raw.byteLength, true)
    dir.setUint16(28, name.byteLength, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), name)
    offset += 30 + name.byteLength + body.byteLength
  }
  const directorySize = central.reduce((sum, part) => sum + part.byteLength, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, inputs.length, true)
  end.setUint16(10, inputs.length, true)
  end.setUint32(12, directorySize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.byteLength, 0))
  let at = 0
  for (const part of all) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}
