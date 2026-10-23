export type AccessUnit = { key: boolean; data: Uint8Array }

const AUD = 9
const IDR = 5
const NON_IDR = 1

function join(parts: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

function startCodes(bytes: Uint8Array): number[] {
  const marks: number[] = []
  for (let i = 0; i + 2 < bytes.byteLength; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue
    marks.push(i)
    i += 2
  }
  return marks
}

function trimTail(bytes: Uint8Array, start: number, end: number): number {
  return end - 1 > start && bytes[end - 1] === 0 ? end - 1 : end
}

function nalType(nal: Uint8Array): number {
  return nal[3] & 0x1f
}

function opensSlice(nal: Uint8Array): boolean {
  return nal.byteLength > 4 && (nal[4] & 0x80) !== 0
}

export class AnnexB {
  private pending: Uint8Array = new Uint8Array(0)
  private unit: Uint8Array[] = []
  private size = 0
  private key = false
  private vcl = false

  push(chunk: Uint8Array): AccessUnit[] {
    const bytes: Uint8Array = join([this.pending, chunk], this.pending.byteLength + chunk.byteLength)
    const marks = startCodes(bytes)
    if (marks.length === 0) {
      this.pending = bytes
      return []
    }
    const out: AccessUnit[] = []
    for (let i = 0; i + 1 < marks.length; i++) {
      const nal = bytes.slice(marks[i], trimTail(bytes, marks[i], marks[i + 1]))
      const emitted = this.take(nal)
      if (emitted) out.push(emitted)
    }
    this.pending = bytes.slice(marks[marks.length - 1])
    return out
  }

  flush(): AccessUnit | null {
    return this.vcl ? this.emit() : null
  }

  private take(nal: Uint8Array): AccessUnit | null {
    if (nal.byteLength < 4) return null
    const type = nalType(nal)
    if (type === 0 || type === 12) return null
    if (this.boundary(type, nal)) {
      const emitted = this.emit()
      this.append(nal)
      return emitted
    }
    this.append(nal)
    return null
  }

  private boundary(type: number, nal: Uint8Array): boolean {
    if (!this.vcl) return false
    if (type === AUD) return true
    if (type !== NON_IDR && type !== IDR) return true
    return opensSlice(nal)
  }

  private append(nal: Uint8Array): void {
    const type = nalType(nal)
    this.unit.push(nal)
    this.size += nal.byteLength
    if (type === NON_IDR || type === IDR) this.vcl = true
    if (type === IDR) this.key = true
  }

  private emit(): AccessUnit {
    const unit = { key: this.key, data: join(this.unit, this.size) }
    this.unit = []
    this.size = 0
    this.key = false
    this.vcl = false
    return unit
  }
}
