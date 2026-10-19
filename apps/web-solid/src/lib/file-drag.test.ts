import { expect, test } from "bun:test"
import { droppedFilePath, FILE_DRAG_TYPE } from "./file-drag"

test("workspace drops preserve the trailing slash identifying folders", () => {
  expect(droppedFilePath({ types: [FILE_DRAG_TYPE], getData: () => "/docs/" })).toBe("docs/")
  expect(droppedFilePath({ types: [FILE_DRAG_TYPE], getData: () => "docs/readme.md" })).toBe("docs/readme.md")
  expect(droppedFilePath({ types: ["text/plain"], getData: () => "docs/" })).toBeNull()
})
