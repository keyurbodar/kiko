import { room } from "../../state/room"

export const isGroupChat = () => room.roomMembers().length > 1
