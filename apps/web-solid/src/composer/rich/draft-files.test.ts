import "fake-indexeddb/auto"
import { expect, test } from "bun:test"
import { clearDraftFiles, deleteDraftFile, listDraftFiles, putDraftFile } from "./draft-files"

const file = (id: string, text: string) => ({ id, name: `${id}.txt`, type: "text/plain", size: text.length, blob: new Blob([text], { type: "text/plain" }) })

test("a chat's files come back with their bytes, and each chat keeps its own", async () => {
  await putDraftFile("room-a", file("one", "hello"))
  await putDraftFile("room-a", file("two", "world!"))
  await putDraftFile("room-b", file("three", "other"))
  const a = await listDraftFiles("room-a")
  expect(a.map((f) => f.id).sort()).toEqual(["one", "two"])
  expect(await a.find((f) => f.id === "two")!.blob.text()).toBe("world!")
  expect(a.find((f) => f.id === "one")).toMatchObject({ name: "one.txt", type: "text/plain", size: 5 })
  expect((await listDraftFiles("room-b")).map((f) => f.id)).toEqual(["three"])
})

test("removing one file leaves the rest, and a send clears the chat's files only", async () => {
  await deleteDraftFile("room-a", "one")
  expect((await listDraftFiles("room-a")).map((f) => f.id)).toEqual(["two"])
  await clearDraftFiles("room-a")
  expect(await listDraftFiles("room-a")).toEqual([])
  expect((await listDraftFiles("room-b")).map((f) => f.id)).toEqual(["three"])
})
