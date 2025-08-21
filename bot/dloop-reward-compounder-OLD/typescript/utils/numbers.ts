/**
 *
 * @param value
 * @param bps
 */
export function bps(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / 10_000n;
}

/**
 *
 * @param value
 * @param bpsDelta
 */
export function addBps(value: bigint, bpsDelta: number): bigint {
  return (value * BigInt(10_000 + bpsDelta)) / 10_000n;
}
