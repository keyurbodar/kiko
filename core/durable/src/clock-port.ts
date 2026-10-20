export interface ClockPort {
  setWakeup(key: string, at: number): Promise<void>
  clearWakeup(key: string): Promise<void>
  dueWakeups(now: number): Promise<string[]>
  deadline(key: string): number | undefined
}
