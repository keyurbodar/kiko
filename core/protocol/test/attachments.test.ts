import { describe, expect, test } from "bun:test"
import { attachmentError, attachmentKind, attachmentsError, limitLabel, MAX_IMAGE_BYTES } from "../src/attachments"


const MB = 1024 * 1024

describe("attachment rules", () => {
	test.each([
		["photo.JPG", "", "image"],
		["shot.png", "application/octet-stream", "image"],
		["anim.gif", "image/gif", "image"],
		["logo.svg", "image/svg+xml", "unsupported-image"],
		["IMG_1.heic", "image/heic", "unsupported-image"],
		["plan.pdf", "application/pdf", "file"],
		["Makefile", "", "file"],
	] as const)("%s (%s) is a %s", (name, type, kind) => {
		expect(attachmentKind({ name, type })).toBe(kind)
	})

	test("a picture may be 10 MB, any other file 50 MB, and nothing may be empty", () => {
		expect(attachmentError({ name: "a.png", type: "image/png", size: MAX_IMAGE_BYTES })).toBeNull()
		expect(attachmentError({ name: "a.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toBe("'a.png' exceeds the 10 MB attachment limit.")
		expect(attachmentError({ name: "a.zip", type: "application/zip", size: 50 * MB + 1 })).toBe("'a.zip' exceeds the 50 MB attachment limit.")
		expect(attachmentError({ name: "a.txt", type: "text/plain", size: 0 })).toBe("'a.txt' is empty or could not be read.")
	})

	test("a message holds at most 100 files and 80 MB of pictures", () => {
		const one = { type: "image/png", size: 10 * MB }
		expect(attachmentsError(Array.from({ length: 8 }, () => one))).toBeNull()
		expect(attachmentsError(Array.from({ length: 9 }, () => one))).toBe("Images can total up to 80 MB per message. Use smaller images or send fewer at once.")
		expect(attachmentsError(Array.from({ length: 101 }, () => ({ type: "text/plain", size: 1 })))).toBe("You can attach up to 100 files per message.")
	})

	test("a limit reads in the largest whole unit", () => {
		expect([limitLabel(10 * MB), limitLabel(512 * 1024), limitLabel(1)]).toEqual(["10 MB", "512 KB", "1 byte"])
	})
})
