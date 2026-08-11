/**
 * Ops-tunable thresholds.
 *
 * These are the knobs that decide what counts as "worth telling a human about".
 * Change the values here; the logic in analyze.ts should not need to change.
 * If you find yourself editing analyze.ts to adjust sensitivity, that's a sign
 * a number belongs in this file instead.
 *
 * HONEST CAVEAT: these are starting guesses, not calibrated on real campaign
 * data. Expect to tune them in the first fortnight against actual traffic.
 * See the "thresholds are guesses" note in the README self-review.
 */
export const RULES = {
  /** A spike needs BOTH a big relative jump... */
  SPIKE_PCT: 0.5, // +50% day-over-day views
  /** ...and enough absolute views to be real. Without this floor, a video
   *  going 4 -> 7 views is a "+75% spike" and the alert becomes noise. */
  SPIKE_MIN_ABS: 100,

  /** Below this day-over-day growth, a video is considered stalled. */
  STALL_PCT: 0.01, // under +1%
  /** ...but only report the *transition*. A video must have been growing at
   *  least this fast yesterday to be flagged as stalling today. Without this,
   *  every video that finished its run keeps firing forever, and an alert that
   *  fires every day is an alert nobody reads. */
  STALL_WAS_GROWING: 0.05, // was doing +5%/day or better

  /** How many "biggest gainers" to name in the Discord embed. */
  TOP_MOVERS: 3,

  /**
   * Growth rates are only comparable when snapshots are one day apart. If the
   * job misses days, a 3-day gain gets read as a 1-day spike. Beyond this gap
   * we still record and still report the delta, but we suppress the spike and
   * stall flags and say why.
   */
  MAX_GAP_DAYS_FOR_RATE_FLAGS: 1,
} as const;
