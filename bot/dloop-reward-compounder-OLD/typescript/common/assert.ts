/**
 * Utility functions for assertions and validation
 */

/**
 * Asserts that a value is not empty (not null, undefined, or empty string)
 */
export function assertNotEmpty<T>(value: T | null | undefined | "", errorMessage?: string): T {
  if (value === null || value === undefined || value === "") {
    throw new Error(errorMessage || "Value cannot be empty");
  }
  return value;
}

/**
 * Asserts that an address is valid (not zero address)
 */
export function assertValidAddress(address: string, errorMessage?: string): string {
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    throw new Error(errorMessage || "Invalid address: zero address");
  }
  return address;
}

/**
 * Asserts that a number is positive
 */
export function assertPositive(value: number, errorMessage?: string): number {
  if (value <= 0) {
    throw new Error(errorMessage || "Value must be positive");
  }
  return value;
}

/**
 * Asserts that a condition is true
 */
export function assert(condition: boolean, errorMessage?: string): void {
  if (!condition) {
    throw new Error(errorMessage || "Assertion failed");
  }
}
