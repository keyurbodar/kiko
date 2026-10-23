import { assert, describe, it } from "@effect/vitest"
import { UploadError } from "./errors"
import { FILE_TOO_LARGE, STORAGE_FULL } from "./file-limits"
import { storageRefusal } from "./paths"

describe("storageRefusal", () => {
  it("reports the two storage refusals the upload routes show", () => {
    assert.strictEqual(
      storageRefusal(new UploadError({ reason: "too_large", message: FILE_TOO_LARGE })),
      FILE_TOO_LARGE,
    )
    assert.strictEqual(storageRefusal(new UploadError({ reason: "storage_full", message: STORAGE_FULL })), STORAGE_FULL)
  })

  it("reads a plain error by its message", () => {
    assert.strictEqual(storageRefusal(new Error(STORAGE_FULL)), STORAGE_FULL)
  })

  it("ignores anything else", () => {
    assert.isNull(storageRefusal(new UploadError({ reason: "no_upload", message: "no such upload" })))
    assert.isNull(storageRefusal(new Error("no such upload")))
    assert.isNull(storageRefusal("boom"))
  })
})
