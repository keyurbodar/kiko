import { RoomLog } from "../room/log"
import { HistoryArchive, UTC_DAY } from "./history-archive"

/** The caller must enforce the existing local-development authorization guard. */
export async function seedArchiveHistory(storage: DurableObjectStorage, history: HistoryArchive, now: number): Promise<void> {
  const cold = Math.floor(now / UTC_DAY) * UTC_DAY - 34 * UTC_DAY
  const coldLog = new RoomLog(storage, () => cold)
  for (let index = 0; index < 5; index++) coldLog.addMessage({ from: { kind: "human" }, text: `Cold archive kumquat ${index}`, clientId: `archive-cold-${index}` })
  const hotLog = new RoomLog(storage, () => now)
  for (let index = 0; index < 240; index++) hotLog.addMessage({ from: { kind: "human" }, text: `Hot archive kumquat ${index}`, clientId: `archive-hot-${index}` })
  await history.afterRun()
}
