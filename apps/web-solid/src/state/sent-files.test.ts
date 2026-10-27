import { describe, expect, it } from "vitest"
import type { ChatMessage, MessageFile } from "../lib/types"
import { withSentFiles } from "./sent-files"

const local: MessageFile[] = [{ name: "a.png", size: 5, type: "image/png", src: "blob:local-a" }]

const view = (files?: MessageFile[]): ChatMessage => ({
  id: "m1",
  threadId: "r1",
  sender: "user",
  body: "",
  sentAt: 1,
  ...(files ? { files } : {}),
})

describe("withSentFiles", () => {
  it("shows the local files on a message the server has not echoed yet", () => {
    expect(withSentFiles(view(), local).files).toEqual(local)
  })

  it("keeps the server's name and path but the local preview once the server echoes", () => {
    const server: MessageFile[] = [
      { name: "a.png", path: "/a.png", size: 5, type: "image/png", src: "/api/files/r1/x" },
    ]
    expect(withSentFiles(view(server), local).files).toEqual([{ ...server[0], src: "blob:local-a" }])
  })

  it("leaves the message alone when the file counts differ", () => {
    const message = view([...local, ...local])
    expect(withSentFiles(message, local)).toBe(message)
  })
})
