export interface ClockPort {
  setWakeup(key: string, at: number): Promise<void>
  clearWakeup(key: string): Promise<void>
  /** Read due deadlines without consuming them; acknowledge only after successful handling. */
  dueWakeups(now: number): Promise<string[]>
  deadline(key: string): number | undefined
}
