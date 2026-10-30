const chat = (roomId: string) => ({
  roomId,
  title: "Bench",
  pinned: false,
  muted: false,
  lastSeq: 0,
  lastPreview: "",
  unread: 0,
  updatedAt: 0,
  agents: ["kiko"],
})

export const user = {
  synced: () => true,
  loaded: () => true,
  chat: (roomId: string) => chat(roomId),
  chats: () => [],
  agents: () => [],
  isGone: () => false,
  open: () => {},
  lastChat: () => null,
  typingByRoom: () => ({}),
  setAgentModel: () => {},
  modelsSynced: () => true,
  agentModel: () => undefined,
}

export const onUserSignal = () => () => {}
