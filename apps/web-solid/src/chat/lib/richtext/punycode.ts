const utf16 = {
  decode: (input: string): number[] => {
    const output: number[] = []
    let i = 0
    const len = input.length
    let value: number
    let extra: number

    while (i < len) {
      value = input.charCodeAt(i++)
      if ((value & 0xf800) === 0xd800) {
        extra = input.charCodeAt(i++)
        if ((value & 0xfc00) !== 0xd800 || (extra & 0xfc00) !== 0xdc00) {
          throw new RangeError("UTF-16(decode): Illegal UTF-16 sequence")
        }
        value = ((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000
      }
      output.push(value)
    }
    return output
  },
  encode: (input: number[]): string => {
    const output: string[] = []
    let i = 0
    const len = input.length
    let value: number

    while (i < len) {
      value = input[i++]
      if ((value & 0xf800) === 0xd800) {
        throw new RangeError("UTF-16(encode): Illegal UTF-16 value")
      }
      if (value > 0xffff) {
        value -= 0x10000
        output.push(String.fromCharCode(((value >>> 10) & 0x3ff) | 0xd800))
        value = 0xdc00 | (value & 0x3ff)
      }
      output.push(String.fromCharCode(value))
    }
    return output.join("")
  },
}

const initial_n = 0x80
const initial_bias = 72
const delimiter = "\x2D"
const base = 36
const damp = 700
const tmin = 1
const tmax = 26
const skew = 38
const maxint = 0x7fffffff

function decode_digit(cp: number): number {
  return cp - 48 < 10 ? cp - 22 : cp - 65 < 26 ? cp - 65 : cp - 97 < 26 ? cp - 97 : base
}

function adapt(delta: number, numpoints: number, firsttime: boolean): number {
  let k
  delta = firsttime ? Math.floor(delta / damp) : delta >> 1
  delta += Math.floor(delta / numpoints)

  for (k = 0; delta > ((base - tmin) * tmax) >> 1; k += base) {
    delta = Math.floor(delta / (base - tmin))
  }
  return Math.floor(k + ((base - tmin + 1) * delta) / (delta + skew))
}

function decode(input: string, preserveCase?: boolean): string {
  const output: number[] = []
  const case_flags: boolean[] = []
  const input_length = input.length

  let n, out, i, bias, basic, ic, oldi, w, k, digit, t

  n = initial_n
  i = 0
  bias = initial_bias

  basic = input.lastIndexOf(delimiter)
  if (basic < 0) basic = 0

  decodeBasic(input, basic, output, case_flags, preserveCase)

  for (ic = basic > 0 ? basic + 1 : 0; ic < input_length;) {
    for (oldi = i, w = 1, k = base; ; k += base) {
      if (ic >= input_length) {
        throw new RangeError("punycode_bad_input(1)")
      }
      digit = decode_digit(input.charCodeAt(ic++))

      if (digit >= base) {
        throw new RangeError("punycode_bad_input(2)")
      }
      if (digit > Math.floor((maxint - i) / w)) {
        throw new RangeError("punycode_overflow(1)")
      }
      i += digit * w
      t = threshold(k, bias)
      if (digit < t) {
        break
      }
      if (w > Math.floor(maxint / (base - t))) {
        throw new RangeError("punycode_overflow(2)")
      }
      w *= base - t
    }

    out = output.length + 1
    bias = adapt(i - oldi, out, oldi === 0)

    if (Math.floor(i / out) > maxint - n) {
      throw new RangeError("punycode_overflow(3)")
    }
    n += Math.floor(i / out)
    i %= out

    if (preserveCase) {
      case_flags.splice(i, 0, input.charCodeAt(ic - 1) - 65 < 26)
    }

    output.splice(i, 0, n)
    i++
  }
  if (preserveCase) restoreCase(output, case_flags)
  return utf16.encode(output)
}

function toUnicode(domain: string): string {
  const domain_array = domain.split(".")
  const out = []
  for (let i = 0; i < domain_array.length; ++i) {
    const s = domain_array[i]
    out.push(s.match(/^xn--/) ? decode(s.slice(4)) : s)
  }
  return out.join(".")
}

export default toUnicode

function restoreCase(output: number[], case_flags: boolean[]): void {
  for (let i = 0, len = output.length; i < len; i++) {
    if (case_flags[i]) output[i] = String.fromCharCode(output[i]).toUpperCase().charCodeAt(0)
  }
}

function decodeBasic(
  input: string,
  basic: number,
  output: number[],
  case_flags: boolean[],
  preserveCase?: boolean,
): void {
  for (let j = 0; j < basic; ++j) {
    if (preserveCase) case_flags[output.length] = input.charCodeAt(j) - 65 < 26
    if (input.charCodeAt(j) >= 0x80) {
      throw new RangeError("Illegal input >= 0x80")
    }
    output.push(input.charCodeAt(j))
  }
}

function threshold(k: number, bias: number): number {
  if (k <= bias) return tmin
  return k >= bias + tmax ? tmax : k - bias
}
