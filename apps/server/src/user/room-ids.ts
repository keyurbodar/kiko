// Room ids are ULIDs, so the server can make one for a chat kiko opens, the way a client does.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function newRoomId(now: number): import("@kiko/protocol").RoomId {
  let t = now
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[t % 32] + head
    t = Math.floor(t / 32)
  }
  return (head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")) as import("@kiko/protocol").RoomId
}
