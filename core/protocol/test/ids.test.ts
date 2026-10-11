import { describe, expect, test } from "bun:test"
import { isRoomId, newRoomId, roomIdTime } from "../src/ids"

describe("room ids", () => {
	test("a new room id is a lowercase UUIDv7", () => {
		const id = newRoomId()
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		expect(isRoomId(id)).toBe(true)
	})

	test("ids made one after another differ and sort in order", () => {
		const a = newRoomId()
		const b = newRoomId()
		expect(a).not.toBe(b)
		expect(a < b).toBe(true)
	})

	test.each([
		["a UUIDv7", "01a0fa46-9777-7fdf-871e-3c63e992c708", true],
		["an old ULID", "01JZ8Q4T6M0000000000000001", true],
		["a UUIDv4", "9b2c4f1e-3a5d-4c7b-8e9f-0a1b2c3d4e5f", false],
		["an uppercase UUIDv7", "01A0FA46-9777-7FDF-871E-3C63E992C708", false],
		["a UUIDv7 with a bad variant", "01a0fa46-9777-7fdf-c71e-3c63e992c708", false],
		["a lowercase ULID", "01jz8q4t6m0000000000000001", false],
		["a word", "general", false],
		["empty", "", false],
	])("%s: %s is a room id: %p", (_, id, ok) => {
		expect(isRoomId(id)).toBe(ok)
	})
})

describe("the time in a room id", () => {
	test.each([0, 1, 1_760_000_000_000, 2 ** 48 - 1])("a UUIDv7 made at %p reads back the same", (at) => {
		expect(roomIdTime(newRoomId(at))).toBe(at)
	})

	test("the example UUIDv7 reads its 48-bit time", () => {
		expect(roomIdTime("01a0fa46-9777-7fdf-871e-3c63e992c708")).toBe(0x01a0fa469777)
	})

	test("an old ULID reads its time", () => {
		expect(roomIdTime("0000000001" + "0".repeat(16))).toBe(1)
		expect(roomIdTime("000000000Z" + "0".repeat(16))).toBe(31)
		expect(roomIdTime("0000000010" + "0".repeat(16))).toBe(32)
	})

	test("anything else has no time", () => {
		expect(roomIdTime("general")).toBeNull()
		expect(roomIdTime("9b2c4f1e-3a5d-4c7b-8e9f-0a1b2c3d4e5f")).toBeNull()
	})
})
