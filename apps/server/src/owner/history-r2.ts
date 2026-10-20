import { listDays, readDay, writeDay } from "./archive"
import type { ArchivedMessage, HistoryArchiveIO } from "./history-archive"

export function historyR2(bucket: R2Bucket): HistoryArchiveIO {
  return {
    writeDay: async (roomId, day, rows) => { await writeDay(bucket, roomId, day, rows) },
    readDay: async (roomId, day) => await readDay<ArchivedMessage>(bucket, roomId, day) ?? [],
    listDays: (roomId) => listDays(bucket, roomId),
  }
}
