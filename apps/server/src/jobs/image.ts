import { decode as decodePng } from "fast-png"
import jpeg from "jpeg-js"
import { rgbaToThumbHash } from "thumbhash"

// Image metadata from bytes. Dimensions come from the header. A thumbhash needs pixels,
// so only PNG and JPEG are decoded. ASSUMPTION: a GIF or WebP gets dimensions and no
// thumbhash, because the Worker has no canvas and a decoder for each would cost more
// than the placeholder is worth.

export type Dimensions = { width: number; height: number }

/** Bytes read from R2 to find the dimensions. Enough for a PNG, a GIF, a WebP, and most JPEG headers. */
export const HEADER_BYTES = 512 * 1024
/** Larger images get dimensions only. The decode would hold too much memory and CPU. */
export const MAX_DECODE_BYTES = 6 * 1024 * 1024
const MAX_DECODE_PIXELS = 24_000_000
const THUMB_SIDE = 100

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))

function dims(width: number, height: number): Dimensions | null {
	return width > 0 && height > 0 ? { width, height } : null
}

function png(b: Uint8Array): Dimensions | null {
	if (b.length < 24 || u32be(b, 0) !== 0x89504e47 || ascii(b, 12, 4) !== "IHDR") return null
	return dims(u32be(b, 16), u32be(b, 20))
}

function gif(b: Uint8Array): Dimensions | null {
	if (b.length < 10 || !/^GIF8[79]a$/.test(ascii(b, 0, 6))) return null
	return dims(u16le(b, 6), u16le(b, 8))
}

function jpegDims(b: Uint8Array): Dimensions | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
	let i = 2
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) {
			i++
			continue
		}
		const marker = b[i + 1]!
		if (marker === 0xff) {
			i++
			continue
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2
			continue
		}
		// Every start-of-frame marker except DHT (c4), JPG (c8), and DAC (cc).
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return dims(u16be(b, i + 7), u16be(b, i + 5))
		}
		i += 2 + u16be(b, i + 2)
	}
	return null
}

function webp(b: Uint8Array): Dimensions | null {
	if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null
	const kind = ascii(b, 12, 4)
	if (kind === "VP8X") return dims(1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)))
	if (kind === "VP8 ") return dims(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff)
	if (kind === "VP8L" && b[20] === 0x2f) {
		const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
		return dims((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
	}
	return null
}

/** The pixel size from the first bytes of a file, or null when the format is not known. */
export function readDimensions(bytes: Uint8Array): Dimensions | null {
	return png(bytes) ?? jpegDims(bytes) ?? gif(bytes) ?? webp(bytes)
}

type Rgba = { width: number; height: number; data: Uint8Array }

function toRgba(bytes: Uint8Array): Rgba | null {
	if (bytes[0] === 0x89) {
		const image = decodePng(bytes)
		const { width, height, channels, depth } = image
		if (image.palette || (depth !== 8 && depth !== 16)) return null
		const src = image.data as Uint8Array | Uint16Array
		const data = new Uint8Array(width * height * 4)
		const shift = depth === 16 ? 8 : 0
		for (let p = 0; p < width * height; p++) {
			const s = p * channels
			const v = (k: number) => src[s + k]! >> shift
			const o = p * 4
			if (channels >= 3) {
				data[o] = v(0)
				data[o + 1] = v(1)
				data[o + 2] = v(2)
				data[o + 3] = channels === 4 ? v(3) : 255
			} else {
				data[o] = data[o + 1] = data[o + 2] = v(0)
				data[o + 3] = channels === 2 ? v(1) : 255
			}
		}
		return { width, height, data }
	}
	if (bytes[0] === 0xff) {
		const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 })
		return { width: image.width, height: image.height, data: image.data as Uint8Array }
	}
	return null
}

/** Box-averages the image down so the longest side is at most `THUMB_SIDE`. Weights by alpha. */
function shrink(image: Rgba): Rgba {
	const scale = Math.min(1, THUMB_SIDE / Math.max(image.width, image.height))
	const w = Math.max(1, Math.round(image.width * scale))
	const h = Math.max(1, Math.round(image.height * scale))
	const out = new Uint8Array(w * h * 4)
	for (let y = 0; y < h; y++) {
		const y0 = Math.floor((y * image.height) / h)
		const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / h))
		for (let x = 0; x < w; x++) {
			const x0 = Math.floor((x * image.width) / w)
			const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / w))
			let r = 0
			let g = 0
			let b = 0
			let a = 0
			for (let yy = y0; yy < y1; yy++) {
				for (let xx = x0; xx < x1; xx++) {
					const i = (yy * image.width + xx) * 4
					const alpha = image.data[i + 3]!
					r += image.data[i]! * alpha
					g += image.data[i + 1]! * alpha
					b += image.data[i + 2]! * alpha
					a += alpha
				}
			}
			const o = (y * w + x) * 4
			if (a > 0) {
				out[o] = Math.round(r / a)
				out[o + 1] = Math.round(g / a)
				out[o + 2] = Math.round(b / a)
			}
			out[o + 3] = Math.round(a / ((y1 - y0) * (x1 - x0)))
		}
	}
	return { width: w, height: h, data: out }
}

function base64(bytes: Uint8Array): string {
	let s = ""
	for (const b of bytes) s += String.fromCharCode(b)
	return btoa(s).replace(/=+$/, "")
}

/**
 * A thumbhash from a full PNG or JPEG file, or null when it cannot be decoded.
 * Throws nothing: a broken image is a file without a placeholder, not a failed job.
 */
export function computeThumbhash(bytes: Uint8Array, size: Dimensions): string | null {
	if (size.width * size.height > MAX_DECODE_PIXELS) return null
	try {
		const decoded = toRgba(bytes)
		if (!decoded) return null
		const small = shrink(decoded)
		return base64(rgbaToThumbHash(small.width, small.height, small.data))
	} catch {
		return null
	}
}
