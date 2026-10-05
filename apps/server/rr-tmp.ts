import { nextOccurrence } from "./src/user/recurrence"
for (const r of ["FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=4", "FREQ=HOURLY;INTERVAL=2;BYHOUR=9,11,13,15,17", "FREQ=MINUTELY;INTERVAL=5;BYHOUR=9,10,11,12,13,14,15,16,17", "FREQ=HOURLY;INTERVAL=2;BYHOUR=9,10,11,12,13,14,15,16,17;BYMINUTE=0"]) {
  const t0 = performance.now()
  let out: string
  try { out = String(nextOccurrence(r, "UTC", Date.now())?.toISOString()) } catch (e) { out = `throws ${e}` }
  console.log(r, out, (performance.now() - t0).toFixed(0), "ms")
}
