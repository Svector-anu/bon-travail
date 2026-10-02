export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

/** Test and demo clock. Time only moves when told to. */
export class ManualClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current
  }

  advance(ms: number): void {
    this.current += ms
  }

  set(ms: number): void {
    this.current = ms
  }
}
