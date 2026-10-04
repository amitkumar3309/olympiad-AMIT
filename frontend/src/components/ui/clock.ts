/**
 * How far the server's clock is ahead of this device's, in milliseconds (Milestone 30).
 *
 * Measure it **when the response carrying `serverNow` arrives** — not later, when a
 * component mounts — and hand it to `Countdown` as `offsetMs`. Every countdown in the
 * product is a display of the server's clock; this is the one number that makes a
 * device that is minutes wrong, or in another time zone, read correctly.
 */
export function clockOffset(serverNow: string | Date, receivedAt: number = Date.now()): number {
  return new Date(serverNow).getTime() - receivedAt
}
