import { expect, test } from "bun:test"
import { newRoomId } from "@kiko/protocol"
import { ClientToRoom, ClientToUser, RoomToClient, UserToClient } from "@kiko/protocol/schema"
import { Channel } from "./client"
import { interObjectCalls, rowsWritten } from "./suites/journal-overhead"

const roomId = newRoomId()
const otherRoomId = newRoomId()

test("room channels hello before subscribing, filter envelopes, replay, send raw and reconnect", async () => {
  const received: unknown[] = []
  let helloReplied = false
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return
      return new Response("websocket required", { status: 400 })
    },
    websocket: {
      message(ws, raw) {
        const frame = JSON.parse(String(raw))
        received.push(frame)
        if (frame.t === "hello") {
          helloReplied = false
          setTimeout(() => {
            helloReplied = true
            ws.send(JSON.stringify({ t: "events", events: [] }))
          }, 20)
        } else if (frame.t === "subscribe") {
          expect(helloReplied).toBe(true)
          ws.send(JSON.stringify({ t: "events", events: [] }))
          ws.send(JSON.stringify({ t: "room", roomId: otherRoomId, frame: { t: "events", events: [] } }))
          ws.send(JSON.stringify({ t: "room", roomId, frame: { t: "events", events: [] } }))
        }
      },
    },
  })
  const channel = new Channel("room", new URL(`ws://localhost:${server.port}/api/ws`), "", RoomToClient, ClientToRoom, { t: "hello", lastSeq: 7 }, roomId)
  try {
    await channel.connect()
    await channel.expect({ t: "events" })
    expect(received.slice(0, 2)).toEqual([{ t: "hello", lastSeq: 0 }, { t: "subscribe", roomId, lastSeq: 7 }])
    expect(channel.log.filter((entry) => entry.dir === "in")).toHaveLength(1)
    channel.send({ t: "typing" })
    channel.sendRaw(JSON.stringify({ t: "hello", lastSeq: 99 }))
    await Bun.sleep(30)
    expect(received).toContainEqual({ t: "room", roomId, frame: { t: "typing" } })
    expect(received).toContainEqual({ t: "subscribe", roomId, lastSeq: 99 })
    await channel.reconnect()
    await channel.expect({ t: "events" })
    expect(received.slice(-2)).toEqual([{ t: "hello", lastSeq: 0 }, { t: "subscribe", roomId, lastSeq: 7 }])
  } finally {
    channel.close()
    server.stop(true)
  }
})

test("standalone user channels retain frames, raw sends and invalid-frame diagnostics", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return
      return new Response("websocket required", { status: 400 })
    },
    websocket: {
      message(ws, raw) {
        const frame = JSON.parse(String(raw))
        ws.send(JSON.stringify(frame.t === "hello" ? { t: "events", events: [] } : { t: "nonsense" }))
      },
    },
  })
  const channel = new Channel("user", new URL(`ws://localhost:${server.port}/`), "", UserToClient, ClientToUser, { t: "hello", lastSeq: 0 })
  try {
    await channel.connect()
    await channel.expect({ t: "events" })
    await channel.reconnect()
    await channel.expect({ t: "events" })
    channel.sendRaw('{"t":"bogus"}')
    await expect(channel.expect({ t: "events" })).rejects.toThrow("invalid frame")
  } finally {
    channel.close()
    server.stop(true)
  }
})

test("physical OWNER counters avoid logical double counting and exclude only the worker boundary RPC", () => {
  expect(rowsWritten({ "owner.rowsWritten": 12, "agent.rowsWritten": 12, "room.rowsWritten": 4 })).toBe(12)
  expect(rowsWritten({ "agent.rowsWritten": 70, "room.rowsWritten": 9 })).toBe(79)
  expect(interObjectCalls({ "rpc.owner.fetch": 4, "rpc.owner": 1, "rpc.agent.receive": 2, "rpc.room.send": 3 })).toBe(5)
})
