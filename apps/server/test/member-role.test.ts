import { ownerRoomFixture } from "./owner-room-fixture"
import { expect, test } from "bun:test"
import type { AgentSlug } from "@kiko/protocol"
import { Members } from "../src/room/members"

test("a stored role is cut to the 400 characters the brief shows, so the stored text is the text a member reads", () => {
  const { storage, log } = ownerRoomFixture({ now: () => 1 })
  const members = new Members(storage, log)
  members.apply({ op: "add", slug: "ada" as AgentSlug, name: "Ada", role: "r".repeat(450) })
  expect(members.get("ada")?.role).toHaveLength(400)
})
